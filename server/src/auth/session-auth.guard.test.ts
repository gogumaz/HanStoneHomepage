import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "./auth.service.js";
import { SessionAuthGuard } from "./session-auth.guard.js";

function context(method: string, originalUrl: string): ExecutionContext {
  const request = { method, originalUrl, headers: { cookie: "baduk_session=child-token" } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("minor session access restriction", () => {
  const auth = {
    getConfig: () => ({ sessionCookieName: "baduk_session" }),
    authenticate: vi.fn(async () => ({
      id: "child-1",
      email: "child@example.test",
      emailVerified: true,
      displayName: "어린이",
      roles: ["student"],
      ageBand: "under_14",
      minorAccountStatus: "guardian_consent_pending",
    })),
  } as unknown as AuthService;

  it("allows only consent setup and account safety routes while consent is pending", async () => {
    const guard = new SessionAuthGuard(auth);
    await expect(guard.canActivate(context("GET", "/api/v1/me"))).resolves.toBe(true);
    await expect(guard.canActivate(context("POST", "/api/v1/me/guardian-invitations"))).resolves.toBe(true);
    await expect(guard.canActivate(context("GET", "/api/v1/me/dashboard")))
      .rejects.toMatchObject({ code: "GUARDIAN_CONSENT_REQUIRED" });
  });
});
