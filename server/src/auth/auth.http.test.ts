import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { ApiResponseInterceptor } from "../common/api-response.interceptor.js";
import { RequestIdMiddleware } from "../common/request-id.middleware.js";
import { PrismaService } from "../database/prisma.service.js";
import { AccountStatus } from "../generated/prisma/enums.js";
import { OAuthClient } from "../components/oauth/index.js";

function createPrismaMock() {
  const users: Array<Record<string, any>> = [];
  const sessions: Array<Record<string, any>> = [];
  const accountTokens: Array<Record<string, any>> = [];
  const oauthAttempts: Array<Record<string, any>> = [];
  const oauthAccounts: Array<Record<string, any>> = [];
  const prisma = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) =>
        users.find((user) => where.email ? user.email === where.email : user.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        const user = {
          id: `user-${users.length + 1}`,
          email: data.email,
          displayName: data.displayName,
          passwordHash: data.passwordHash,
          emailVerifiedAt: data.emailVerifiedAt ?? null,
          status: AccountStatus.ACTIVE,
          roles: data.roles.create,
        };
        users.push(user);
        const oauthAccount = data.oauthAccounts?.create?.[0];
        if (oauthAccount) {
          oauthAccounts.push({
            id: `oauth-account-${oauthAccounts.length + 1}`,
            userId: user.id,
            ...oauthAccount,
          });
        }
        return user;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
        const user = users.find((item) => item.id === where.id);
        Object.assign(user ?? {}, data);
        return user;
      }),
    },
    session: {
      create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        const session = {
          id: `session-${sessions.length + 1}`,
          ...data,
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
      update: vi.fn(({ where, data }: { where: { tokenHash: string }; data: Record<string, unknown> }) => {
        const session = sessions.find((item) => item.tokenHash === where.tokenHash);
        Object.assign(session ?? {}, data);
        return Promise.resolve(session);
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
        const matches = sessions.filter((item) => item.userId === where.userId && (!('revokedAt' in where) || item.revokedAt === where.revokedAt));
        matches.forEach((item) => Object.assign(item, data));
        return { count: matches.length };
      }),
    },
    accountToken: {
      create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        const item = { id: `token-${accountTokens.length + 1}`, ...data, consumedAt: null };
        accountTokens.push(item);
        return item;
      }),
      findUnique: vi.fn(async ({ where, include }: { where: { tokenHash: string }; include?: unknown }) => {
        const item = accountTokens.find((candidate) => candidate.tokenHash === where.tokenHash);
        if (!item) return null;
        return include ? { ...item, user: users.find((user) => user.id === item.userId) } : item;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
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
    oAuthLoginAttempt: {
      create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        const attempt = {
          id: `oauth-attempt-${oauthAttempts.length + 1}`,
          ...data,
          consumedAt: null,
          createdAt: new Date(),
        };
        oauthAttempts.push(attempt);
        return attempt;
      }),
      findUnique: vi.fn(async ({ where }: { where: { stateHash: string } }) =>
        oauthAttempts.find((item) => item.stateHash === where.stateHash) ?? null),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
        const matches = oauthAttempts.filter((item) =>
          item.id === where.id
          && item.consumedAt === where.consumedAt
          && item.expiresAt > where.expiresAt.gt);
        matches.forEach((item) => Object.assign(item, data));
        return { count: matches.length };
      }),
    },
    oAuthAccount: {
      findUnique: vi.fn(async ({ where, include }: { where: Record<string, any>; include?: unknown }) => {
        const key = where.provider_providerUserId;
        const account = oauthAccounts.find((item) =>
          item.provider === key.provider && item.providerUserId === key.providerUserId);
        if (!account) return null;
        return include ? { ...account, user: users.find((user) => user.id === account.userId) } : account;
      }),
    },
    auditLog: { create: vi.fn(async () => ({ id: "audit" })) },
    isReady: vi.fn(async () => true),
    $transaction: vi.fn(async (input: unknown) => {
      if (typeof input === "function") {
        return (input as (transaction: typeof prisma) => unknown)(prisma);
      }
      return Promise.all(input as Promise<unknown>[]);
    }),
  };
  return prisma as unknown as PrismaService;
}

describe("authentication HTTP flow", () => {
  let app: INestApplication;
  let baseUrl: string;
  const oauthClient = {
    createAuthorizationUrl: vi.fn((_provider: string, request: { state: string; nonce: string; codeChallenge: string }) => {
      const url = new URL("https://oauth.example.test/authorize");
      url.searchParams.set("state", request.state);
      url.searchParams.set("nonce", request.nonce);
      url.searchParams.set("code_challenge", request.codeChallenge);
      return url;
    }),
    exchangeCode: vi.fn(async (provider: string) => ({
      provider,
      subject: "oauth-subject-1",
      email: "oauth-member@example.com",
      emailVerified: true,
      displayName: "OAuth 회원",
    })),
  };

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    process.env.SESSION_COOKIE_NAME = "baduk_session";

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(createPrismaMock())
      .overrideProvider(OAuthClient)
      .useValue(oauthClient)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    const requestId = new RequestIdMiddleware();
    app.use(requestId.use.bind(requestId));
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it("signs up, reads the session, logs out, and rejects the revoked cookie", async () => {
    const signupResponse = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_http_test_123",
      },
      body: JSON.stringify({
        email: "http@example.com",
        password: "safe-password-123",
        displayName: "HTTP 회원",
        role: "student",
      }),
    });
    const signup = await signupResponse.json() as {
      data: { user: { roles: string[]; emailVerified: boolean }; developmentVerificationToken: string };
    };
    const cookie = signupResponse.headers.get("set-cookie")?.split(";", 1)[0];

    expect(signupResponse.status).toBe(201);
    expect(signupResponse.headers.get("x-request-id")).toBe("req_http_test_123");
    expect(cookie).toMatch(/^baduk_session=/);
    expect(signup.data.user.roles).toEqual(["student"]);
    expect(signup.data.user.emailVerified).toBe(false);
    expect(signup.data.developmentVerificationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const meResponse = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { cookie: cookie ?? "" },
    });
    const me = await meResponse.json() as { data: { user: { email: string } } };
    expect(meResponse.status).toBe(200);
    expect(me.data.user.email).toBe("http@example.com");

    const verifyResponse = await fetch(`${baseUrl}/api/v1/auth/email-verification/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: signup.data.developmentVerificationToken }),
    });
    expect(verifyResponse.status).toBe(200);

    const verifiedMeResponse = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { cookie: cookie ?? "" },
    });
    const verifiedMe = await verifiedMeResponse.json() as { data: { user: { emailVerified: boolean } } };
    expect(verifiedMe.data.user.emailVerified).toBe(true);

    const reusedVerificationResponse = await fetch(`${baseUrl}/api/v1/auth/email-verification/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: signup.data.developmentVerificationToken }),
    });
    expect(reusedVerificationResponse.status).toBe(400);

    const logoutResponse = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: "POST",
      headers: { cookie: cookie ?? "" },
    });
    expect(logoutResponse.status).toBe(200);

    const revokedResponse = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { cookie: cookie ?? "" },
    });
    const revoked = await revokedResponse.json() as { error: { code: string; requestId: string } };
    expect(revokedResponse.status).toBe(401);
    expect(revoked.error.code).toBe("SESSION_INVALID");
    expect(revoked.error.requestId).toMatch(/^req_/);

    const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "http@example.com", password: "safe-password-123" }),
    });
    const loginCookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
    expect(loginResponse.status).toBe(200);
    expect(loginCookie).toMatch(/^baduk_session=/);

    const refreshResponse = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { cookie: loginCookie ?? "" },
    });
    const refreshCookie = refreshResponse.headers.get("set-cookie")?.split(";", 1)[0];
    expect(refreshResponse.status).toBe(200);
    expect(refreshCookie).toMatch(/^baduk_session=/);
    expect(refreshCookie).not.toBe(loginCookie);

    const resetRequestResponse = await fetch(`${baseUrl}/api/v1/auth/password-reset/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "http@example.com" }),
    });
    const resetRequest = await resetRequestResponse.json() as {
      data: { accepted: true; developmentToken: string };
    };
    expect(resetRequestResponse.status).toBe(202);
    expect(resetRequest.data.accepted).toBe(true);

    const unknownResetResponse = await fetch(`${baseUrl}/api/v1/auth/password-reset/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "missing@example.com" }),
    });
    const unknownReset = await unknownResetResponse.json() as {
      data: { accepted: true; developmentToken: string };
    };
    expect(unknownResetResponse.status).toBe(202);
    expect(Object.keys(unknownReset.data).sort()).toEqual(Object.keys(resetRequest.data).sort());

    const resetConfirmResponse = await fetch(`${baseUrl}/api/v1/auth/password-reset/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: refreshCookie ?? "" },
      body: JSON.stringify({ token: resetRequest.data.developmentToken, password: "new-password-456" }),
    });
    expect(resetConfirmResponse.status).toBe(200);
    expect(resetConfirmResponse.headers.get("set-cookie")).toContain("baduk_session=");

    const resetRevokedResponse = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { cookie: refreshCookie ?? "" },
    });
    expect(resetRevokedResponse.status).toBe(401);

    const oldPasswordResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "http@example.com", password: "safe-password-123" }),
    });
    expect(oldPasswordResponse.status).toBe(401);

    const newPasswordResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "http@example.com", password: "new-password-456" }),
    });
    expect(newPasswordResponse.status).toBe(200);
  });

  it("starts OAuth with state, PKCE and nonce, then creates a session exactly once", async () => {
    const startResponse = await fetch(
      `${baseUrl}/api/v1/auth/oauth/google/start?returnTo=${encodeURIComponent("/dashboard?welcome=1")}`,
      { redirect: "manual" },
    );
    expect(startResponse.status).toBe(302);
    const authorizationUrl = new URL(startResponse.headers.get("location") ?? "");
    const state = authorizationUrl.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorizationUrl.searchParams.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorizationUrl.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const callbackResponse = await fetch(
      `${baseUrl}/api/v1/auth/oauth/google/callback?code=oauth-code&state=${state}`,
      { redirect: "manual" },
    );
    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toBe("http://127.0.0.1:5173/dashboard?welcome=1");
    const cookie = callbackResponse.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toMatch(/^baduk_session=/);

    const meResponse = await fetch(`${baseUrl}/api/v1/me`, { headers: { cookie: cookie ?? "" } });
    const me = await meResponse.json() as { data: { user: { email: string; emailVerified: boolean } } };
    expect(me.data.user).toMatchObject({ email: "oauth-member@example.com", emailVerified: true });

    const reusedResponse = await fetch(
      `${baseUrl}/api/v1/auth/oauth/google/callback?code=oauth-code&state=${state}`,
      { redirect: "manual" },
    );
    expect(reusedResponse.status).toBe(400);

    oauthClient.exchangeCode.mockResolvedValueOnce({
      provider: "google",
      subject: "oauth-subject-existing-email",
      email: "http@example.com",
      emailVerified: true,
      displayName: "기존 이메일 OAuth",
    });
    const linkingStart = await fetch(`${baseUrl}/api/v1/auth/oauth/google/start`, { redirect: "manual" });
    const linkingState = new URL(linkingStart.headers.get("location") ?? "").searchParams.get("state");
    const linkingCallback = await fetch(
      `${baseUrl}/api/v1/auth/oauth/google/callback?code=link-code&state=${linkingState}`,
      { redirect: "manual" },
    );
    const linkingError = await linkingCallback.json() as { error: { code: string } };
    expect(linkingCallback.status).toBe(409);
    expect(linkingError.error.code).toBe("OAUTH_ACCOUNT_LINK_REQUIRED");
  });
});
