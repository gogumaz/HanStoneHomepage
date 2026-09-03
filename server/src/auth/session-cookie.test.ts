import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config/app-config.js";
import { clearSessionCookie, setSessionCookie, type CookieResponse } from "./session-cookie.js";

function config(nodeEnv: AppConfig["nodeEnv"]): AppConfig {
  return {
    nodeEnv,
    sessionCookieName: "baduk_session",
  } as AppConfig;
}

describe("session cookie security", () => {
  it("sets every required browser security attribute in production", () => {
    const response: CookieResponse = {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    };
    const expires = new Date("2026-09-01T00:00:00.000Z");

    setSessionCookie(response, config("production"), "opaque-session-token", expires);

    expect(response.cookie).toHaveBeenCalledWith("baduk_session", "opaque-session-token", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires,
    });
  });

  it("uses the same security scope when expiring the production cookie", () => {
    const response: CookieResponse = {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    };

    clearSessionCookie(response, config("production"));

    expect(response.clearCookie).toHaveBeenCalledWith("baduk_session", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  });
});
