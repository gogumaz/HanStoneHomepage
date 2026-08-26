import { describe, expect, it } from "vitest";
import type { ApiRequest } from "../common/http-types.js";
import { isSessionMutationAllowed } from "./session-csrf.guard.js";

const config = {
  sessionCookieName: "baduk_session",
  corsOrigins: ["https://www.example.com"],
  publicAppUrl: "https://www.example.com",
};

function request(
  method: string,
  headers: ApiRequest["headers"],
): ApiRequest & { method: string } {
  return { method, headers };
}

describe("session CSRF origin policy", () => {
  it("does not restrict safe methods or requests without a session cookie", () => {
    expect(isSessionMutationAllowed(request("GET", {
      cookie: "baduk_session=session-token",
      origin: "https://attacker.example",
    }), config)).toBe(true);
    expect(isSessionMutationAllowed(request("POST", {
      origin: "https://attacker.example",
    }), config)).toBe(true);
  });

  it("allows an authenticated mutation from an approved web origin", () => {
    expect(isSessionMutationAllowed(request("POST", {
      cookie: "baduk_session=session-token",
      origin: "https://www.example.com",
      "sec-fetch-site": "same-site",
    }), config)).toBe(true);
  });

  it("rejects hostile or explicitly cross-site authenticated mutations", () => {
    expect(isSessionMutationAllowed(request("DELETE", {
      cookie: "baduk_session=session-token",
      origin: "https://attacker.example",
    }), config)).toBe(false);
    expect(isSessionMutationAllowed(request("POST", {
      cookie: "baduk_session=session-token",
      "sec-fetch-site": "cross-site",
    }), config)).toBe(false);
  });

  it("allows non-browser session API clients that do not send browser origin metadata", () => {
    expect(isSessionMutationAllowed(request("PATCH", {
      cookie: "baduk_session=session-token",
    }), config)).toBe(true);
  });
});
