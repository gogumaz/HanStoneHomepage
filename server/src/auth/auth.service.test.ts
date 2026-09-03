import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../common/api-error.js";
import type { PrismaService } from "../database/prisma.service.js";
import { AccountStatus, AccountTokenPurpose, AgeBand, MinorAccountStatus, RoleType } from "../generated/prisma/enums.js";
import { AuthService } from "./auth.service.js";
import { hashPassword, verifyPassword } from "./password.js";
import { hashSessionToken } from "./session-cookie.js";
import type { AccountMailService } from "../mail/account-mail.service.js";
import { decryptAccountMailToken } from "../mail/account-mail-token-crypto.js";

type StoredUser = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  status: AccountStatus;
  roles: Array<{ role: RoleType }>;
  ageBand: AgeBand;
  minorAccountStatus: MinorAccountStatus;
  guardianConsentVerifiedAt: Date | null;
};

type StoredAccountToken = {
  id: string;
  userId: string;
  purpose: AccountTokenPurpose;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

type StoredSession = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

function createPrismaMock() {
  const users: StoredUser[] = [];
  const sessions: StoredSession[] = [];
  const accountTokens: StoredAccountToken[] = [];
  let nextUserId = 1;
  let nextSessionId = 1;

  const prisma = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) =>
        users.find((user) => where.email ? user.email === where.email : user.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        const user: StoredUser = {
          id: `user-${nextUserId++}`,
          email: data.email,
          displayName: data.displayName,
          passwordHash: data.passwordHash,
          emailVerifiedAt: null,
          status: AccountStatus.ACTIVE,
          roles: data.roles.create,
          ageBand: data.ageBand,
          minorAccountStatus: data.minorAccountStatus,
          guardianConsentVerifiedAt: null,
        };
        users.push(user);
        return user;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<StoredUser> }) => {
        const user = users.find((item) => item.id === where.id);
        if (!user) throw new Error("missing user");
        Object.assign(user, data);
        return user;
      }),
    },
    session: {
      create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        const session: StoredSession = {
          id: `session-${nextSessionId++}`,
          userId: data.userId,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
          revokedAt: null,
        };
        sessions.push(session);
        return session;
      }),
      findUnique: vi.fn(async ({ where, include }: { where: { tokenHash: string }; include?: unknown }) => {
        const session = sessions.find((item) => item.tokenHash === where.tokenHash);
        if (!session) return null;
        if (!include) return session;
        return { ...session, user: users.find((user) => user.id === session.userId) };
      }),
      update: vi.fn(({ where, data }: { where: { tokenHash: string }; data: { revokedAt: Date } }) => {
        const session = sessions.find((item) => item.tokenHash === where.tokenHash);
        if (!session) throw new Error("missing session");
        session.revokedAt = data.revokedAt;
        return Promise.resolve(session);
      }),
      updateMany: vi.fn(async ({ where, data }: {
        where: { userId: string; revokedAt?: null };
        data: { revokedAt: Date };
      }) => {
        const matches = sessions.filter((item) => item.userId === where.userId && (!('revokedAt' in where) || item.revokedAt === where.revokedAt));
        matches.forEach((item) => Object.assign(item, data));
        return { count: matches.length };
      }),
    },
    accountToken: {
      create: vi.fn(async ({ data }: { data: Omit<StoredAccountToken, "id" | "consumedAt"> }) => {
        const item: StoredAccountToken = {
          id: `account-token-${accountTokens.length + 1}`,
          ...data,
          consumedAt: null,
        };
        accountTokens.push(item);
        return item;
      }),
      findUnique: vi.fn(async ({ where, include }: { where: { tokenHash: string }; include?: unknown }) => {
        const item = accountTokens.find((candidate) => candidate.tokenHash === where.tokenHash);
        if (!item) return null;
        return include ? { ...item, user: users.find((user) => user.id === item.userId) } : item;
      }),
      updateMany: vi.fn(async ({ where, data }: {
        where: { id?: string; userId?: string; purpose?: AccountTokenPurpose; consumedAt?: null; expiresAt?: { gt: Date } };
        data: { consumedAt: Date };
      }) => {
        const matches = accountTokens.filter((item) =>
          (!where.id || item.id === where.id)
          && (!where.userId || item.userId === where.userId)
          && (!where.purpose || item.purpose === where.purpose)
          && (!('consumedAt' in where) || item.consumedAt === where.consumedAt)
          && (!where.expiresAt?.gt || item.expiresAt > where.expiresAt.gt));
        matches.forEach((item) => Object.assign(item, data));
        return { count: matches.length };
      }),
    },
    auditLog: {
      create: vi.fn(async () => ({ id: "audit" })),
    },
    $transaction: vi.fn(async (input: unknown) => {
      if (typeof input === "function") {
        return (input as (transaction: typeof prisma) => unknown)(prisma);
      }
      return Promise.all(input as Promise<unknown>[]);
    }),
  };

  return { prisma: prisma as unknown as PrismaService, users, sessions, accountTokens };
}

describe("AuthService", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    process.env.SESSION_TTL_HOURS = "24";
    delete process.env.ACCOUNT_MAIL_ENCRYPTION_KEY_BASE64;
  });

  it("creates a student account, hashes its password, and authenticates the session", async () => {
    const state = createPrismaMock();
    const service = new AuthService(state.prisma);

    const result = await service.signup({
      email: "Student@Example.com",
      password: "safe-password-123",
      displayName: "바둑 학생",
      role: "student",
      ageBand: "adult",
    }, "req_signup_test");

    expect(result.user).toMatchObject({ email: "student@example.com", roles: ["student"] });
    expect(state.users[0]?.passwordHash).not.toBe("safe-password-123");
    await expect(verifyPassword("safe-password-123", state.users[0]?.passwordHash ?? "")).resolves.toBe(true);
    await expect(service.authenticate(result.sessionToken)).resolves.toEqual(result.user);
  });

  it("creates an under-14 account in guardian-consent-pending state", async () => {
    const state = createPrismaMock();
    const service = new AuthService(state.prisma);

    const result = await service.signup({
      email: "child@example.com",
      password: "safe-password-123",
      displayName: "어린이 회원",
      role: "student",
      ageBand: "under_14",
    });

    expect(result.user).toMatchObject({
      ageBand: "under_14",
      minorAccountStatus: "guardian_consent_pending",
      guardianConsentVerifiedAt: null,
    });
  });

  it("does not allow a public signup to grant an operator role", async () => {
    const service = new AuthService(createPrismaMock().prisma);

    await expect(service.signup({
      email: "operator@example.com",
      password: "safe-password-123",
      displayName: "운영자 요청",
      role: "operator",
      ageBand: "adult",
    })).rejects.toMatchObject({ code: "INVALID_ROLE" } satisfies Partial<ApiError>);
  });

  it("returns a generic credential error for a wrong password", async () => {
    const state = createPrismaMock();
    state.users.push({
      id: "user-existing",
      email: "member@example.com",
      displayName: "기존 회원",
      passwordHash: await hashPassword("safe-password-123"),
      emailVerifiedAt: null,
      status: AccountStatus.ACTIVE,
      roles: [{ role: RoleType.GUARDIAN }],
      ageBand: AgeBand.ADULT,
      minorAccountStatus: MinorAccountStatus.NOT_APPLICABLE,
      guardianConsentVerifiedAt: null,
    });
    const service = new AuthService(state.prisma);

    await expect(service.login({
      email: "member@example.com",
      password: "wrong-password",
    })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" } satisfies Partial<ApiError>);
  });

  it("rotates a session and rejects the revoked token", async () => {
    const state = createPrismaMock();
    const service = new AuthService(state.prisma);
    const signup = await service.signup({
      email: "rotate@example.com",
      password: "safe-password-123",
      displayName: "세션 회전",
      role: "guardian",
      ageBand: "adult",
    });

    const refreshed = await service.refresh(signup.sessionToken, "req_refresh_test");

    expect(refreshed.sessionToken).not.toBe(signup.sessionToken);
    expect(state.sessions.find((item) => item.tokenHash === hashSessionToken(signup.sessionToken))?.revokedAt).toBeInstanceOf(Date);
    await expect(service.authenticate(signup.sessionToken)).rejects.toMatchObject(
      { code: "SESSION_INVALID" } satisfies Partial<ApiError>,
    );
    await expect(service.authenticate(refreshed.sessionToken)).resolves.toEqual(refreshed.user);
  });

  it("verifies email with a single-use token", async () => {
    const state = createPrismaMock();
    const service = new AuthService(state.prisma);
    const signup = await service.signup({
      email: "verify@example.com",
      password: "safe-password-123",
      displayName: "인증 회원",
      role: "student",
      ageBand: "adult",
    });

    expect(signup.user.emailVerified).toBe(false);
    expect(signup.developmentVerificationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(service.confirmEmailVerification({
      token: signup.developmentVerificationToken,
    })).resolves.toMatchObject({ verified: true });
    await expect(service.authenticate(signup.sessionToken)).resolves.toMatchObject({ emailVerified: true });
    await expect(service.confirmEmailVerification({
      token: signup.developmentVerificationToken,
    })).rejects.toMatchObject({ code: "EMAIL_VERIFICATION_TOKEN_INVALID" } satisfies Partial<ApiError>);
  });

  it("resets a password once and revokes every existing session", async () => {
    const state = createPrismaMock();
    const service = new AuthService(state.prisma);
    const signup = await service.signup({
      email: "reset@example.com",
      password: "old-password-123",
      displayName: "복구 회원",
      role: "guardian",
      ageBand: "adult",
    });
    const secondSession = await service.login({
      email: "reset@example.com",
      password: "old-password-123",
    });

    const request = await service.requestPasswordReset({ email: "reset@example.com" });
    expect(request).toMatchObject({ accepted: true });
    expect(request.developmentToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(service.confirmPasswordReset({
      token: request.developmentToken,
      password: "new-password-456",
    })).resolves.toEqual({ reset: true });

    await expect(service.authenticate(signup.sessionToken)).rejects.toMatchObject({ code: "SESSION_INVALID" });
    await expect(service.authenticate(secondSession.sessionToken)).rejects.toMatchObject({ code: "SESSION_INVALID" });
    await expect(service.login({
      email: "reset@example.com",
      password: "old-password-123",
    })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(service.login({
      email: "reset@example.com",
      password: "new-password-456",
    })).resolves.toMatchObject({ user: { email: "reset@example.com" } });
    await expect(service.confirmPasswordReset({
      token: request.developmentToken,
      password: "another-password-789",
    })).rejects.toMatchObject({ code: "PASSWORD_RESET_TOKEN_INVALID" });
  });

  it("returns the same reset-request shape for an unknown email", async () => {
    const service = new AuthService(createPrismaMock().prisma);
    const result = await service.requestPasswordReset({ email: "unknown@example.com" });

    expect(result.accepted).toBe(true);
    expect(result.developmentToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("queues account email without delaying the signup response and audits delivery", async () => {
    const state = createPrismaMock();
    const sendEmailVerification = vi.fn(async () => ({
      status: "sent" as const,
      messageId: "mail-signup-test",
    }));
    const mail = { sendEmailVerification } as unknown as AccountMailService;
    const service = new AuthService(state.prisma, mail);

    const signup = await service.signup({
      email: "mail@example.com",
      password: "safe-password-123",
      displayName: "메일 회원",
      role: "student",
      ageBand: "adult",
    }, "req_mail_test");

    expect(signup.user.email).toBe("mail@example.com");
    expect(sendEmailVerification).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(sendEmailVerification).toHaveBeenCalledWith(expect.objectContaining({
      email: "mail@example.com",
      token: signup.developmentVerificationToken,
    })));
    await vi.waitFor(() => expect(state.prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "mail.account.email_verification.sent",
        requestId: "req_mail_test",
        metadata: expect.objectContaining({ messageId: "mail-signup-test", status: "sent" }),
      }),
    }));
  });

  it("stores an encrypted durable mail job when the queue key is configured", async () => {
    const state = createPrismaMock();
    const key = Buffer.alloc(32, 5).toString("base64");
    process.env.ACCOUNT_MAIL_ENCRYPTION_KEY_BASE64 = key;
    const sendEmailVerification = vi.fn();
    const service = new AuthService(
      state.prisma,
      { sendEmailVerification } as unknown as AccountMailService,
    );

    const signup = await service.signup({
      email: "durable-mail@example.com",
      password: "safe-password-123",
      displayName: "영속 메일 회원",
      role: "student",
      ageBand: "adult",
    }, "req_durable_mail");

    const createData = vi.mocked(state.prisma.accountToken.create).mock.calls[0]?.[0].data as {
      mailJob: { create: { encryptedToken: string; requestId: string } };
    };
    expect(createData.mailJob.create.encryptedToken).not.toContain(signup.developmentVerificationToken as string);
    expect(decryptAccountMailToken(createData.mailJob.create.encryptedToken, key))
      .toBe(signup.developmentVerificationToken);
    expect(createData.mailJob.create.requestId).toBe("req_durable_mail");
    expect(sendEmailVerification).not.toHaveBeenCalled();
  });

  it("keeps signup successful and audits a background mail failure", async () => {
    const state = createPrismaMock();
    const sendEmailVerification = vi.fn(async () => {
      throw new Error("simulated SMTP failure");
    });
    const mail = { sendEmailVerification } as unknown as AccountMailService;
    const service = new AuthService(state.prisma, mail);

    await expect(service.signup({
      email: "mail-failure@example.com",
      password: "safe-password-123",
      displayName: "발송 실패 회원",
      role: "student",
      ageBand: "adult",
    }, "req_mail_failure")).resolves.toMatchObject({
      user: { email: "mail-failure@example.com" },
    });

    await vi.waitFor(() => expect(state.prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "mail.account.email_verification.failed",
        requestId: "req_mail_failure",
        metadata: { errorName: "Error", status: "failed" },
      }),
    }));
  });
});
