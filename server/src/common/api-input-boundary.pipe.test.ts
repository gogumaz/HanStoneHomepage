import type { ArgumentMetadata } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ApiInputBoundaryPipe } from "./api-input-boundary.pipe.js";

const metadata = (type: ArgumentMetadata["type"], data?: string): ArgumentMetadata => ({ type, data });

describe("API input boundary", () => {
  const pipe = new ApiInputBoundaryPipe();

  it("accepts ordinary server-validated bodies, parameters, and queries", () => {
    expect(pipe.transform({ title: "한국사", tags: ["고조선"] }, metadata("body")))
      .toEqual({ title: "한국사", tags: ["고조선"] });
    expect(pipe.transform("lesson-PRE-01", metadata("param"))).toBe("lesson-PRE-01");
    expect(pipe.transform({ page: "1", search: "주먹도끼" }, metadata("query")))
      .toEqual({ page: "1", search: "주먹도끼" });
  });

  it("rejects malformed path parameters before controller execution", () => {
    expect(() => pipe.transform("", metadata("param"))).toThrow(/요청 본문 또는 URL/);
    expect(() => pipe.transform("x".repeat(201), metadata("param"))).toThrow(/요청 본문 또는 URL/);
    expect(() => pipe.transform("lesson\u0000id", metadata("param"))).toThrow(/요청 본문 또는 URL/);
  });

  it("accepts a scalar value selected by a named query decorator", () => {
    expect(pipe.transform("/account", metadata("query", "returnTo"))).toBe("/account");
    expect(pipe.transform(undefined, metadata("query", "returnTo"))).toBeUndefined();
  });

  it("rejects unsafe scalar values selected by a named query decorator", () => {
    expect(() => pipe.transform("x".repeat(2_049), metadata("query", "returnTo"))).toThrow();
    expect(() => pipe.transform("/account\u0000", metadata("query", "returnTo"))).toThrow();
  });

  it("rejects unsafe body and query shapes before semantic service validation", () => {
    expect(() => pipe.transform("not-an-object", metadata("body"))).toThrow(/요청 본문 또는 URL/);
    expect(() => pipe.transform({ search: "x".repeat(2_049) }, metadata("query")))
      .toThrow(/요청 본문 또는 URL/);
    expect(() => pipe.transform({ nested: { constructor: "pollute" } }, metadata("body")))
      .toThrow(/요청 본문 또는 URL/);
  });
});
