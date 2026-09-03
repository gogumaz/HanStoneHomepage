import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthService } from "../auth/auth.service.js";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { ApiResponseInterceptor } from "../common/api-response.interceptor.js";
import { RequestIdMiddleware } from "../common/request-id.middleware.js";
import { DatabaseModule } from "../database/database.module.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  OrganizationMembershipStatus,
  RoleVerificationStatus,
  SubscriptionPaymentStatus,
} from "../generated/prisma/enums.js";
import { SubscriptionModule } from "../subscription/subscription.module.js";
import { listenForHttpTest } from "../test-utils/listen-test-app.js";
import { OrganizationModule } from "./organization.module.js";

const formerInstructor: CurrentUser = {
  id: "former-instructor-user",
  email: "former-instructor@example.com",
  emailVerified: true,
  displayName: "퇴사 지도자",
  roles: ["instructor"],
};
const personalSubscription = {
  id: "personal-subscription-1",
  orderId: "personal-order-1",
  planId: "subscription-6m",
  planLabelSnapshot: "6개월",
  monthsSnapshot: 6,
  amountSnapshot: 50_000,
  paymentStatus: SubscriptionPaymentStatus.PAID,
  refundedAmount: 0,
  refundedAt: null,
  paidAt: new Date(Date.now() - 86_400_000),
  startsAt: new Date(Date.now() - 86_400_000),
  endsAt: new Date(Date.now() + 86_400_000),
};

const membershipFindMany = vi.fn(async () => []);
const assignmentFindMany = vi.fn(async () => []);
const subscriptionFindMany = vi.fn(async () => [personalSubscription]);
const prisma = {
  userRoleAssignment: {
    findUnique: vi.fn(async () => ({ verificationStatus: RoleVerificationStatus.VERIFIED })),
  },
  organizationMembership: { findMany: membershipFindMany },
  organizationClassTeacherAssignment: { findMany: assignmentFindMany },
  accountSubscription: { findMany: subscriptionFindMany },
} as unknown as PrismaService;

const authService = {
  getConfig: () => ({ sessionCookieName: "baduk_session" }),
  authenticate: vi.fn(async (token?: string | null) => (
    token === "former-instructor" ? formerInstructor : null
  )),
};

describe("ended organization membership isolation HTTP API", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, OrganizationModule, SubscriptionModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(AuthService)
      .useValue(authService)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    const requestId = new RequestIdMiddleware();
    app.use(requestId.use.bind(requestId));
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    baseUrl = await listenForHttpTest(app);
  });

  afterAll(async () => app?.close());

  it("blocks organization data while preserving the account and personal subscription", async () => {
    const headers = { cookie: "baduk_session=former-instructor" };
    const organizationClasses = await fetch(`${baseUrl}/api/v1/teacher/classes`, { headers });
    const organizationBody = await organizationClasses.json() as { error: { code: string } };
    const account = await fetch(`${baseUrl}/api/v1/me`, { headers });
    const accountBody = await account.json() as { data: { user: CurrentUser } };
    const subscriptions = await fetch(`${baseUrl}/api/v1/me/subscriptions`, { headers });
    const subscriptionsBody = await subscriptions.json() as {
      data: { items: Array<{ id: string; active: boolean; paymentStatus: string }> };
    };

    expect(organizationClasses.status).toBe(403);
    expect(organizationBody.error.code).toBe("ORGANIZATION_MEMBERSHIP_REQUIRED");
    expect(membershipFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: formerInstructor.id,
        status: OrganizationMembershipStatus.ACTIVE,
        OR: [{ endsAt: null }, { endsAt: { gt: expect.any(Date) } }],
      }),
    }));
    expect(assignmentFindMany).not.toHaveBeenCalled();

    expect(account.status).toBe(200);
    expect(accountBody.data.user).toMatchObject({
      id: formerInstructor.id,
      email: formerInstructor.email,
      roles: ["instructor"],
    });
    expect(subscriptions.status).toBe(200);
    expect(subscriptionsBody.data.items).toEqual([expect.objectContaining({
      id: personalSubscription.id,
      active: true,
      paymentStatus: "paid",
    })]);
    expect(subscriptionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: formerInstructor.id },
    }));
  });
});
