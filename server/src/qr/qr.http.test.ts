import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { ApiResponseInterceptor } from "../common/api-response.interceptor.js";
import { RequestIdMiddleware } from "../common/request-id.middleware.js";
import { PrismaService } from "../database/prisma.service.js";
import { LessonQrCodeStatus, LessonStatus } from "../generated/prisma/enums.js";
import { listenForHttpTest } from "../test-utils/listen-test-app.js";
import { hashQrCode } from "./qr.service.js";

const qrRecords = [
  {
    id: "00000000-0000-4000-8000-000000000701",
    codeHash: hashQrCode("QR-PREHISTORIC-0001"),
    lessonId: "PRE-01",
    status: LessonQrCodeStatus.ACTIVE,
    expiresAt: new Date(Date.now() + 60_000),
    maxClaims: null,
    claimCount: 0,
    lesson: { id: "PRE-01", title: "주먹도끼에서 배운 첫 수", status: LessonStatus.PUBLISHED },
  },
  {
    id: "00000000-0000-4000-8000-000000000702",
    codeHash: hashQrCode("QR-GOJOSEON-000002"),
    lessonId: "GOJ-01",
    status: LessonQrCodeStatus.ACTIVE,
    expiresAt: null,
    maxClaims: 10,
    claimCount: 2,
    lesson: { id: "GOJ-01", title: "고조선의 첫 수", status: LessonStatus.PUBLISHED },
  },
  {
    id: "00000000-0000-4000-8000-000000000703",
    codeHash: hashQrCode("QR-EXPIRED-CODE-001"),
    lessonId: "PRE-01",
    status: LessonQrCodeStatus.ACTIVE,
    expiresAt: new Date(Date.now() - 60_000),
    maxClaims: 1,
    claimCount: 0,
    lesson: { id: "PRE-01", title: "주먹도끼에서 배운 첫 수", status: LessonStatus.PUBLISHED },
  },
  {
    id: "00000000-0000-4000-8000-000000000704",
    codeHash: hashQrCode("QR-USED-UP-CODE-001"),
    lessonId: "GOJ-01",
    status: LessonQrCodeStatus.ACTIVE,
    expiresAt: null,
    maxClaims: 1,
    claimCount: 1,
    lesson: { id: "GOJ-01", title: "고조선의 첫 수", status: LessonStatus.PUBLISHED },
  },
];

function createPrismaMock(): PrismaService {
  return {
    lessonQrCode: {
      findUnique: vi.fn(async ({ where }: { where: { codeHash: string } }) =>
        qrRecords.find((record) => record.codeHash === where.codeHash) ?? null),
    },
    isReady: vi.fn(async () => true),
  } as unknown as PrismaService;
}

describe("textbook QR HTTP API", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(createPrismaMock())
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    const requestId = new RequestIdMiddleware();
    app.use(requestId.use.bind(requestId));
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    baseUrl = await listenForHttpTest(app);
  });

  afterAll(async () => app.close());

  it("resolves each opaque QR code to its exact published lesson", async () => {
    const cases = [
      ["qr-prehistoric-0001", "PRE-01", "/lessons/PRE-01"],
      ["QR-GOJOSEON-000002", "GOJ-01", "/lessons/GOJ-01"],
    ] as const;

    for (const [code, lessonId, path] of cases) {
      const response = await fetch(`${baseUrl}/api/v1/qr/${code}`);
      const body = await response.json() as {
        data: { status: string; target: { lesson: { id: string }; path: string } };
      };
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(body.data).toMatchObject({
        status: "active",
        target: { lesson: { id: lessonId }, path },
      });
      expect(JSON.stringify(body)).not.toContain("codeHash");
    }
  });

  it("does not fall back to a different lesson for an unknown code", async () => {
    const response = await fetch(`${baseUrl}/api/v1/qr/QR-UNKNOWN-CODE-0001`);
    const body = await response.json() as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("QR_CODE_NOT_FOUND");
  });

  it.each([
    ["QR-EXPIRED-CODE-001", "expired", 1],
    ["QR-USED-UP-CODE-001", "used", 0],
  ] as const)("returns the %s code state without a lesson target", async (code, status, remainingClaims) => {
    const response = await fetch(`${baseUrl}/api/v1/qr/${code}`);
    const body = await response.json() as {
      data: { status: string; expiresAt: string | null; remainingClaims: number | null; target: null };
    };

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ status, remainingClaims, target: null });
    if (status === "expired") expect(body.data.expiresAt).toBeTruthy();
  });
});
