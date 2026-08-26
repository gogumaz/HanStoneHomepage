import { describe, expect, it } from "vitest";
import { ApiError } from "./api-error.js";
import {
  optionalString,
  readInputObject,
  requiredInteger,
  requiredString,
  requiredTrue,
} from "./input-validation.js";

describe("input validation helpers", () => {
  it("normalizes an allow-listed object", () => {
    const input = readInputObject({ name: "  홍길동  " }, ["name"], "INVALID", "invalid");
    expect(requiredString(input, "name", { minLength: 2, maxLength: 20 }, "INVALID", "invalid"))
      .toBe("홍길동");
  });

  it.each([null, [], "text", { name: "ok", admin: true }])(
    "rejects malformed input or unknown fields: %j",
    (value) => {
      expect(() => readInputObject(value, ["name"], "INVALID", "invalid"))
        .toThrowError(ApiError);
    },
  );

  it("validates optional strings, integer bounds, and explicit consent", () => {
    const input = readInputObject(
      { email: "", count: 12, consent: true },
      ["email", "count", "consent"],
      "INVALID",
      "invalid",
    );
    expect(optionalString(input, "email", { maxLength: 254 }, "INVALID", "invalid")).toBeNull();
    expect(requiredInteger(input, "count", 1, 100, "INVALID", "invalid")).toBe(12);
    expect(requiredTrue(input, "consent", "INVALID", "invalid")).toBe(true);
  });

  it("rejects coercion-prone values", () => {
    const input = { count: "12", consent: 1 };
    expect(() => requiredInteger(input, "count", 1, 100, "INVALID", "invalid"))
      .toThrowError(ApiError);
    expect(() => requiredTrue(input, "consent", "INVALID", "invalid"))
      .toThrowError(ApiError);
  });
});
