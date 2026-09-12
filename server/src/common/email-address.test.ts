import { describe, expect, it } from "vitest";
import { isEmailAddress } from "./email-address.js";

describe("isEmailAddress", () => {
  it.each([
    "member@example.com",
    "student.name+course@sub.example.co.kr",
  ])("accepts a bounded address: %s", (value) => {
    expect(isEmailAddress(value)).toBe(true);
  });

  it.each([
    "",
    "missing-at.example.com",
    "double@@example.com",
    "member@example",
    "member@.example",
    "member@example.",
    "member @example.com",
    `member@${"a".repeat(250)}.com`,
  ])("rejects an invalid address without backtracking: %s", (value) => {
    expect(isEmailAddress(value)).toBe(false);
  });
});
