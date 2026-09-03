import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { ApiResponseInterceptor } from "../common/api-response.interceptor.js";
import { RequestIdMiddleware } from "../common/request-id.middleware.js";
import { PrismaService } from "../database/prisma.service.js";
import { listenForHttpTest } from "../test-utils/listen-test-app.js";
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
          ageBand: data.ageBand,
          minorAccountStatus: data.minorAccountStatus,
          guardianConsentVerifiedAt: null,
        };
        users.push(user);
        const oauthAccount = data.oauthAccounts?.create?.[0];
        if (oauthAccount) {
          oauthAccounts.push({
            id: `oauth-account-${oauthAccounts.length + 1}`,
            userId: user.id,
            ...oauthAccount,
            createdAt: new Date(),
            updatedAt: new Date(),
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
      deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
        const matches = sessions.filter((item) => item.userId === where.userId);
        matches.forEach((item) => sessions.splice(sessions.indexOf(item), 1));
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
      deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
        const matches = accountTokens.filter((item) => item.userId === where.userId);
        matches.forEach((item) => accountTokens.splice(accountTokens.indexOf(item), 1));
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
      deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
        const matches = oauthAttempts.filter((item) => item.userId === where.userId);
        matches.forEach((item) => oauthAttempts.splice(oauthAttempts.indexOf(item), 1));
        return { count: matches.length };
      }),
    },
    oAuthAccount: {
      findUnique: vi.fn(async ({ where, include }: { where: Record<string, any>; include?: unknown }) => {
        const subjectKey = where.provider_providerUserId;
        const userKey = where.userId_provider;
        const account = oauthAccounts.find((item) => subjectKey
          ? item.provider === subjectKey.provider && item.providerUserId === subjectKey.providerUserId
          : item.userId === userKey.userId && item.provider === userKey.provider);
        if (!account) return null;
        return include ? { ...account, user: users.find((user) => user.id === account.userId) } : account;
      }),
      findMany: vi.fn(async ({ where }: { where: { userId: string } }) =>
        oauthAccounts
          .filter((item) => item.userId === where.userId)
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())),
      create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        const account = {
          id: `oauth-account-${oauthAccounts.length + 1}`,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        oauthAccounts.push(account);
        return account;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = oauthAccounts.findIndex((item) => item.id === where.id);
        return oauthAccounts.splice(index, 1)[0];
      }),
      deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
        const matches = oauthAccounts.filter((item) => item.userId === where.userId);
        matches.forEach((item) => oauthAccounts.splice(oauthAccounts.indexOf(item), 1));
        return { count: matches.length };
      }),
    },
    userRoleAssignment: {
      deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
        const user = users.find((item) => item.id === where.userId);
        if (user) user.roles = [];
        return { count: user?.roles.length ?? 0 };
      }),
    },
    guardianInvitation: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    guardianLink: { updateMany: vi.fn(async () => ({ count: 0 })) },
    guardianConsent: { updateMany: vi.fn(async () => ({ count: 0 })) },
    lessonProgress: { deleteMany: vi.fn(async () => ({ count: 0 })) },
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
    baseUrl = await listenForHttpTest(app);
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
        ageBand: "adult",
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

    const rejectedLogoutResponse = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: "POST",
      headers: {
        cookie: cookie ?? "",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
    });
    const rejectedLogout = await rejectedLogoutResponse.json() as { error: { code: string } };
    expect(rejectedLogoutResponse.status).toBe(403);
    expect(rejectedLogout.error.code).toBe("CSRF_ORIGIN_REJECTED");

    const sessionAfterRejectedLogout = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { cookie: cookie ?? "" },
    });
    expect(sessionAfterRejectedLogout.status).toBe(200);

    const logoutResponse = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: "POST",
      headers: { cookie: cookie ?? "" },
    });
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.headers.get("set-cookie")).toMatch(
      /^baduk_session=;.*Expires=Thu, 01 Jan 1970 00:00:00 GMT/i,
    );

    const revokedResponse = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { cookie: cookie ?? "" },
    });
    const revoked = await revokedResponse.json() as { error: { code: string; requestId: string } };
    expect(revokedResponse.status).toBe(401);
    expect(revoked.error.code).toBe("SESSION_INVALID");
    expect(revoked.error.requestId).toMatch(/^req_/);

    const repeatedLogoutResponse = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: "POST",
      headers: { cookie: cookie ?? "" },
    });
    expect(repeatedLogoutResponse.status).toBe(200);

    const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "http@example.com", password: "safe-password-123" }),
    });
    const loginCookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
    expect(loginResponse.status).toBe(200);
    expect(loginCookie).toMatch(/^baduk_session=/);
    expect(loginResponse.headers.get("ratelimit-limit")).toBe("10");
    expect(Number(loginResponse.headers.get("ratelimit-remaining"))).toBeGreaterThanOrEqual(0);

    const refreshResponse = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: {
        cookie: loginCookie ?? "",
        origin: "http://127.0.0.1:5173",
        "sec-fetch-site": "same-site",
      },
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

  it("completes a Google OIDC callback with state, PKCE and nonce, then creates a session exactly once", async () => {
    const startResponse = await fetch(
      `${baseUrl}/api/v1/auth/oauth/google/start?returnTo=${encodeURIComponent("/dashboard?welcome=1")}`,
      { redirect: "manual" },
    );
    expect(startResponse.status).toBe(302);
    const authorizationUrl = new URL(startResponse.headers.get("location") ?? "");
    const state = authorizationUrl.searchParams.get("state");
    const nonce = authorizationUrl.searchParams.get("nonce");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorizationUrl.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(oauthClient.createAuthorizationUrl).toHaveBeenLastCalledWith("google", expect.objectContaining({
      state,
      nonce,
      codeChallenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    }));

    const callbackResponse = await fetch(
      `${baseUrl}/api/v1/auth/oauth/google/callback?code=oauth-code&state=${state}`,
      { redirect: "manual" },
    );
    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toBe("http://127.0.0.1:5173/dashboard?welcome=1");
    const cookie = callbackResponse.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toMatch(/^baduk_session=/);
    expect(oauthClient.exchangeCode).toHaveBeenLastCalledWith("google", expect.objectContaining({
      code: "oauth-code",
      state,
      nonce,
      codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    }));

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

  it("rejects malformed, tampered, and cross-provider OAuth state before token exchange", async () => {
    const exchangeCallsBefore = oauthClient.exchangeCode.mock.calls.length;
    const malformedResponse = await fetch(
      `${baseUrl}/api/v1/auth/oauth/google/callback?code=oauth-code&state=too-short`,
      { redirect: "manual" },
    );
    const malformed = await malformedResponse.json() as { error: { code: string } };
    expect(malformedResponse.status).toBe(400);
    expect(malformed.error.code).toBe("OAUTH_CALLBACK_INVALID");

    const startResponse = await fetch(`${baseUrl}/api/v1/auth/oauth/google/start`, { redirect: "manual" });
    const state = new URL(startResponse.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const replacement = state.endsWith("A") ? "B" : "A";
    const tamperedState = `${state.slice(0, -1)}${replacement}`;
    const tamperedResponse = await fetch(
      `${baseUrl}/api/v1/auth/oauth/google/callback?code=oauth-code&state=${tamperedState}`,
      { redirect: "manual" },
    );
    const tampered = await tamperedResponse.json() as { error: { code: string } };
    expect(tamperedResponse.status).toBe(400);
    expect(tampered.error.code).toBe("OAUTH_STATE_INVALID");

    const wrongProviderResponse = await fetch(
      `${baseUrl}/api/v1/auth/oauth/naver/callback?code=oauth-code&state=${state}`,
      { redirect: "manual" },
    );
    const wrongProvider = await wrongProviderResponse.json() as { error: { code: string } };
    expect(wrongProviderResponse.status).toBe(400);
    expect(wrongProvider.error.code).toBe("OAUTH_STATE_INVALID");
    expect(oauthClient.exchangeCode).toHaveBeenCalledTimes(exchangeCallsBefore);

    oauthClient.exchangeCode.mockResolvedValueOnce({
      provider: "google",
      subject: "google-state-security-subject",
      email: "google-state-security@example.com",
      emailVerified: true,
      displayName: "Google state 보안 회원",
    });
    const validResponse = await fetch(
      `${baseUrl}/api/v1/auth/oauth/google/callback?code=oauth-code&state=${state}`,
      { redirect: "manual" },
    );
    expect(validResponse.status).toBe(302);
    expect(validResponse.headers.get("set-cookie")).toContain("baduk_session=");

    const replayResponse = await fetch(
      `${baseUrl}/api/v1/auth/oauth/google/callback?code=oauth-code&state=${state}`,
      { redirect: "manual" },
    );
    const replay = await replayResponse.json() as { error: { code: string } };
    expect(replayResponse.status).toBe(400);
    expect(replay.error.code).toBe("OAUTH_STATE_INVALID");
  });

  it("completes a Naver login callback and creates an authenticated session", async () => {
    oauthClient.exchangeCode.mockResolvedValueOnce({
      provider: "naver",
      subject: "naver-login-subject-1",
      email: "naver-login@example.com",
      emailVerified: false,
      displayName: "네이버 로그인 회원",
    });
    const returnTo = "/qr/QR-PREHISTORIC-0001";
    const startResponse = await fetch(
      `${baseUrl}/api/v1/auth/oauth/naver/start?returnTo=${encodeURIComponent(returnTo)}`,
      { redirect: "manual" },
    );

    expect(startResponse.status).toBe(302);
    const authorizationUrl = new URL(startResponse.headers.get("location") ?? "");
    const state = authorizationUrl.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(oauthClient.createAuthorizationUrl).toHaveBeenLastCalledWith("naver", expect.objectContaining({
      state,
      nonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      codeChallenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    }));

    const callbackResponse = await fetch(
      `${baseUrl}/api/v1/auth/oauth/naver/callback?code=naver-code&state=${state}`,
      { redirect: "manual" },
    );
    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toBe(`http://127.0.0.1:5173${returnTo}`);
    const cookie = callbackResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    expect(cookie).toMatch(/^baduk_session=/);
    expect(oauthClient.exchangeCode).toHaveBeenLastCalledWith("naver", expect.objectContaining({
      code: "naver-code",
      state,
      codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    }));

    const meResponse = await fetch(`${baseUrl}/api/v1/me`, { headers: { cookie } });
    const me = await meResponse.json() as {
      data: { user: { email: string; emailVerified: boolean; displayName: string } };
    };
    expect(meResponse.status).toBe(200);
    expect(me.data.user).toMatchObject({
      email: "naver-login@example.com",
      emailVerified: false,
      displayName: "네이버 로그인 회원",
    });

    const replayResponse = await fetch(
      `${baseUrl}/api/v1/auth/oauth/naver/callback?code=naver-code&state=${state}`,
      { redirect: "manual" },
    );
    expect(replayResponse.status).toBe(400);
  });

  it("completes a Kakao login callback and creates an authenticated session", async () => {
    oauthClient.exchangeCode.mockResolvedValueOnce({
      provider: "kakao",
      subject: "kakao-login-subject-1",
      email: "kakao-login@example.com",
      emailVerified: true,
      displayName: "카카오 로그인 회원",
    });
    const returnTo = "/dashboard?from=kakao";
    const startResponse = await fetch(
      `${baseUrl}/api/v1/auth/oauth/kakao/start?returnTo=${encodeURIComponent(returnTo)}`,
      { redirect: "manual" },
    );

    expect(startResponse.status).toBe(302);
    const authorizationUrl = new URL(startResponse.headers.get("location") ?? "");
    const state = authorizationUrl.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(oauthClient.createAuthorizationUrl).toHaveBeenLastCalledWith("kakao", expect.objectContaining({
      state,
      nonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      codeChallenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    }));

    const callbackResponse = await fetch(
      `${baseUrl}/api/v1/auth/oauth/kakao/callback?code=kakao-code&state=${state}`,
      { redirect: "manual" },
    );
    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toBe(`http://127.0.0.1:5173${returnTo}`);
    const cookie = callbackResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    expect(cookie).toMatch(/^baduk_session=/);
    expect(oauthClient.exchangeCode).toHaveBeenLastCalledWith("kakao", expect.objectContaining({
      code: "kakao-code",
      state,
      codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    }));

    const meResponse = await fetch(`${baseUrl}/api/v1/me`, { headers: { cookie } });
    const me = await meResponse.json() as {
      data: { user: { email: string; emailVerified: boolean; displayName: string } };
    };
    expect(meResponse.status).toBe(200);
    expect(me.data.user).toMatchObject({
      email: "kakao-login@example.com",
      emailVerified: true,
      displayName: "카카오 로그인 회원",
    });

    const replayResponse = await fetch(
      `${baseUrl}/api/v1/auth/oauth/kakao/callback?code=kakao-code&state=${state}`,
      { redirect: "manual" },
    );
    expect(replayResponse.status).toBe(400);
  });

  it("links and unlinks an OAuth identity without replacing the active password session", async () => {
    const signupResponse = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "oauth-link-owner@example.com",
        password: "safe-password-789",
        displayName: "OAuth Link Owner",
        role: "student",
        ageBand: "adult",
      }),
    });
    const cookie = signupResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    expect(signupResponse.status).toBe(201);

    oauthClient.exchangeCode.mockResolvedValueOnce({
      provider: "google",
      subject: "oauth-link-subject-1",
      email: "linked-google@example.com",
      emailVerified: true,
      displayName: "Linked Google",
    });
    const startResponse = await fetch(
      `${baseUrl}/api/v1/me/oauth-accounts/google/start?returnTo=${encodeURIComponent("/account?oauthLinked=google")}`,
      { headers: { cookie }, redirect: "manual" },
    );
    expect(startResponse.status).toBe(302);
    const state = new URL(startResponse.headers.get("location") ?? "").searchParams.get("state");

    const callbackResponse = await fetch(
      `${baseUrl}/api/v1/auth/oauth/google/callback?code=link-code&state=${state}`,
      { redirect: "manual" },
    );
    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toBe("http://127.0.0.1:5173/account?oauthLinked=google");
    expect(callbackResponse.headers.get("set-cookie")).toBeNull();

    const linkedResponse = await fetch(`${baseUrl}/api/v1/me/oauth-accounts`, { headers: { cookie } });
    const linked = await linkedResponse.json() as {
      data: { items: Array<{ provider: string; email: string }>; hasPassword: boolean };
    };
    expect(linkedResponse.status).toBe(200);
    expect(linked.data).toMatchObject({
      hasPassword: true,
      items: [{ provider: "google", email: "linked-google@example.com" }],
    });

    const unlinkResponse = await fetch(`${baseUrl}/api/v1/me/oauth-accounts/google`, {
      method: "DELETE",
      headers: { cookie },
    });
    const unlinked = await unlinkResponse.json() as { data: { unlinked: boolean; provider: string } };
    expect(unlinkResponse.status).toBe(200);
    expect(unlinked.data).toEqual({ unlinked: true, provider: "google" });

    const emptyResponse = await fetch(`${baseUrl}/api/v1/me/oauth-accounts`, { headers: { cookie } });
    const empty = await emptyResponse.json() as { data: { items: unknown[]; hasPassword: boolean } };
    expect(empty.data).toEqual({ items: [], hasPassword: true });
  });

  it("rejects linking an OAuth identity owned by another user and protects the last sign-in method", async () => {
    oauthClient.exchangeCode.mockResolvedValueOnce({
      provider: "kakao",
      subject: "oauth-only-subject",
      email: "oauth-only@example.com",
      emailVerified: true,
      displayName: "OAuth Only",
    });
    const loginStart = await fetch(`${baseUrl}/api/v1/auth/oauth/kakao/start`, { redirect: "manual" });
    const loginState = new URL(loginStart.headers.get("location") ?? "").searchParams.get("state");
    const loginCallback = await fetch(
      `${baseUrl}/api/v1/auth/oauth/kakao/callback?code=oauth-login-code&state=${loginState}`,
      { redirect: "manual" },
    );
    const oauthOnlyCookie = loginCallback.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    expect(loginCallback.status).toBe(302);
    expect((await fetch(`${baseUrl}/api/v1/me/age-band`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: oauthOnlyCookie },
      body: JSON.stringify({ ageBand: "adult" }),
    })).status).toBe(200);

    const lastMethodResponse = await fetch(`${baseUrl}/api/v1/me/oauth-accounts/kakao`, {
      method: "DELETE",
      headers: { cookie: oauthOnlyCookie },
    });
    const lastMethodError = await lastMethodResponse.json() as { error: { code: string } };
    expect(lastMethodResponse.status).toBe(409);
    expect(lastMethodError.error.code).toBe("LAST_SIGN_IN_METHOD_REQUIRED");

    const ownerSignup = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "oauth-conflict-owner@example.com",
        password: "safe-password-987",
        displayName: "OAuth Conflict Owner",
        role: "student",
        ageBand: "adult",
      }),
    });
    const ownerCookie = ownerSignup.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const linkStart = await fetch(`${baseUrl}/api/v1/me/oauth-accounts/kakao/start`, {
      headers: { cookie: ownerCookie },
      redirect: "manual",
    });
    const linkState = new URL(linkStart.headers.get("location") ?? "").searchParams.get("state");
    oauthClient.exchangeCode.mockResolvedValueOnce({
      provider: "kakao",
      subject: "oauth-only-subject",
      email: "oauth-only@example.com",
      emailVerified: true,
      displayName: "OAuth Only",
    });
    const conflictResponse = await fetch(
      `${baseUrl}/api/v1/auth/oauth/kakao/callback?code=conflict-code&state=${linkState}`,
      { redirect: "manual" },
    );
    const conflict = await conflictResponse.json() as { error: { code: string } };
    expect(conflictResponse.status).toBe(409);
    expect(conflict.error.code).toBe("OAUTH_IDENTITY_ALREADY_LINKED");
  });

  it("requires the current password, anonymizes the account, and invalidates every session", async () => {
    const signupResponse = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "delete-password@example.com",
        password: "safe-password-delete",
        displayName: "Delete Password User",
        role: "student",
        ageBand: "adult",
      }),
    });
    const cookie = signupResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? "";

    const wrongPasswordResponse = await fetch(`${baseUrl}/api/v1/me`, {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ confirmation: "회원탈퇴", password: "wrong-password" }),
    });
    const wrongPassword = await wrongPasswordResponse.json() as { error: { code: string } };
    expect(wrongPasswordResponse.status).toBe(401);
    expect(wrongPassword.error.code).toBe("ACCOUNT_DELETE_REAUTHENTICATION_FAILED");

    const invalidConfirmationResponse = await fetch(`${baseUrl}/api/v1/me`, {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ confirmation: "delete", password: "safe-password-delete" }),
    });
    expect(invalidConfirmationResponse.status).toBe(400);

    const deleteResponse = await fetch(`${baseUrl}/api/v1/me`, {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ confirmation: "회원탈퇴", password: "safe-password-delete" }),
    });
    const deleted = await deleteResponse.json() as { data: { deleted: boolean } };
    expect(deleteResponse.status).toBe(200);
    expect(deleted.data).toEqual({ deleted: true });
    expect(deleteResponse.headers.get("set-cookie")).toContain("baduk_session=");

    const staleSessionResponse = await fetch(`${baseUrl}/api/v1/me`, { headers: { cookie } });
    expect(staleSessionResponse.status).toBe(401);

    const reusedEmailResponse = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "delete-password@example.com",
        password: "new-password-after-delete",
        displayName: "Recreated User",
        role: "student",
        ageBand: "adult",
      }),
    });
    expect(reusedEmailResponse.status).toBe(201);
  });

  it("requires the exact linked OAuth identity before deleting an OAuth-only account", async () => {
    oauthClient.exchangeCode.mockResolvedValueOnce({
      provider: "naver",
      subject: "oauth-delete-subject",
      email: "delete-oauth@example.com",
      emailVerified: true,
      displayName: "Delete OAuth User",
    });
    const loginStart = await fetch(`${baseUrl}/api/v1/auth/oauth/naver/start`, { redirect: "manual" });
    const loginState = new URL(loginStart.headers.get("location") ?? "").searchParams.get("state");
    const loginCallback = await fetch(
      `${baseUrl}/api/v1/auth/oauth/naver/callback?code=oauth-delete-login&state=${loginState}`,
      { redirect: "manual" },
    );
    const cookie = loginCallback.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    expect((await fetch(`${baseUrl}/api/v1/me/age-band`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ageBand: "adult" }),
    })).status).toBe(200);

    const mismatchStart = await fetch(`${baseUrl}/api/v1/me/account-deletion/oauth/naver/start`, {
      headers: { cookie },
      redirect: "manual",
    });
    const mismatchState = new URL(mismatchStart.headers.get("location") ?? "").searchParams.get("state");
    oauthClient.exchangeCode.mockResolvedValueOnce({
      provider: "naver",
      subject: "different-oauth-subject",
      email: "different@example.com",
      emailVerified: true,
      displayName: "Different OAuth User",
    });
    const mismatchResponse = await fetch(
      `${baseUrl}/api/v1/auth/oauth/naver/callback?code=oauth-delete-mismatch&state=${mismatchState}`,
      { redirect: "manual" },
    );
    const mismatch = await mismatchResponse.json() as { error: { code: string } };
    expect(mismatchResponse.status).toBe(401);
    expect(mismatch.error.code).toBe("ACCOUNT_DELETE_REAUTHENTICATION_FAILED");
    expect((await fetch(`${baseUrl}/api/v1/me`, { headers: { cookie } })).status).toBe(200);

    const deleteStart = await fetch(
      `${baseUrl}/api/v1/me/account-deletion/oauth/naver/start?returnTo=${encodeURIComponent("/account?accountDeleted=1")}`,
      { headers: { cookie }, redirect: "manual" },
    );
    const deleteState = new URL(deleteStart.headers.get("location") ?? "").searchParams.get("state");
    oauthClient.exchangeCode.mockResolvedValueOnce({
      provider: "naver",
      subject: "oauth-delete-subject",
      email: "delete-oauth@example.com",
      emailVerified: true,
      displayName: "Delete OAuth User",
    });
    const deleteCallback = await fetch(
      `${baseUrl}/api/v1/auth/oauth/naver/callback?code=oauth-delete-confirm&state=${deleteState}`,
      { redirect: "manual" },
    );
    expect(deleteCallback.status).toBe(302);
    expect(deleteCallback.headers.get("location")).toBe("http://127.0.0.1:5173/account?accountDeleted=1");
    expect(deleteCallback.headers.get("set-cookie")).toContain("baduk_session=");
    expect((await fetch(`${baseUrl}/api/v1/me`, { headers: { cookie } })).status).toBe(401);
  });
});
