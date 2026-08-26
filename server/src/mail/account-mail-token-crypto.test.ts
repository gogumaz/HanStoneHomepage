import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptAccountMailToken, encryptAccountMailToken } from "./account-mail-token-crypto.js";

describe("account mail token encryption", () => {
  it("round-trips a token without exposing it in the stored payload", () => {
    const key = randomBytes(32).toString("base64");
    const token = "single-use-account-token";
    const encrypted = encryptAccountMailToken(token, key);
    expect(encrypted).not.toContain(token);
    expect(decryptAccountMailToken(encrypted, key)).toBe(token);
  });

  it("rejects tampered ciphertext and a different key", () => {
    const key = randomBytes(32).toString("base64");
    const encrypted = encryptAccountMailToken("secret", key);
    const parts = encrypted.split(".");
    parts[3] = `${parts[3]?.startsWith("A") ? "B" : "A"}${parts[3]?.slice(1)}`;
    expect(() => decryptAccountMailToken(parts.join("."), key)).toThrow();
    expect(() => decryptAccountMailToken(encrypted, randomBytes(32).toString("base64"))).toThrow();
  });
});
