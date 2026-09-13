import { describe, expect, it } from "vitest";
import {
  generateClassInviteCode,
  hashClassInviteCode,
  isClassInviteCode,
  normalizeClassInviteCode,
} from "./class-invite-code.js";

describe("organization class invite codes", () => {
  it("generates a user-readable code with at least 60 bits of entropy", () => {
    const code = generateClassInviteCode();

    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/u);
    expect(isClassInviteCode(code)).toBe(true);
    expect(normalizeClassInviteCode(code)).toHaveLength(12);
  });

  it("normalizes harmless separators while hashing a single canonical value", () => {
    expect(normalizeClassInviteCode(" abcd efgh-jklm ")).toBe("ABCDEFGHJKLM");
    expect(hashClassInviteCode("ABCD-EFGH-JKLM")).toBe(hashClassInviteCode("abcd efgh jklm"));
    expect(isClassInviteCode("ABCI-EFGH-JKLM")).toBe(false);
    expect(isClassInviteCode("A".repeat(65))).toBe(false);
  });
});
