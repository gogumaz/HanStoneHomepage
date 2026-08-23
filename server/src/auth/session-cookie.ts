import { createHash, randomBytes } from "node:crypto";
import type { AppConfig } from "../config/app-config.js";
import type { ApiRequest } from "../common/http-types.js";

export type CookieResponse = {
  cookie(name: string, value: string, options: Record<string, unknown>): void;
  clearCookie(name: string, options: Record<string, unknown>): void;
};

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readSessionToken(request: ApiRequest, cookieName: string): string | null {
  const cookieHeader = request.headers.cookie;
  const raw = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
  if (!raw) return null;

  for (const segment of raw.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0) continue;
    const name = segment.slice(0, separator).trim();
    if (name !== cookieName) continue;
    try {
      return decodeURIComponent(segment.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function cookieOptions(config: AppConfig): Record<string, unknown> {
  return {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax",
    path: "/",
  };
}

export function setSessionCookie(
  response: CookieResponse,
  config: AppConfig,
  token: string,
  expiresAt: Date,
): void {
  response.cookie(config.sessionCookieName, token, {
    ...cookieOptions(config),
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: CookieResponse, config: AppConfig): void {
  response.clearCookie(config.sessionCookieName, cookieOptions(config));
}
