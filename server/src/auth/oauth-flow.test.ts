import { describe, expect, it } from "vitest";
import { createPkceChallenge, normalizeReturnTo } from "./oauth-flow.js";

describe("OAuth flow helpers", () => {
  it("keeps internal return paths and rejects external redirects", () => {
    expect(normalizeReturnTo("/dashboard?from=oauth#next")).toBe("/dashboard?from=oauth#next");
    expect(normalizeReturnTo("https://attacker.example/path")).toBe("/");
    expect(normalizeReturnTo("//attacker.example/path")).toBe("/");
    expect(normalizeReturnTo("/\\attacker.example")).toBe("/");
  });

  it("creates an RFC 7636-style base64url SHA-256 challenge", () => {
    expect(createPkceChallenge("test-verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
