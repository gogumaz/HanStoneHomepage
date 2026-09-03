import type { ArgumentMetadata } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ApiInputBoundaryPipe } from "./api-input-boundary.pipe.js";

const metadata = (type: ArgumentMetadata["type"]): ArgumentMetadata => ({ type });

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

  it("rejects unsafe body and query shapes before semantic service validation", () => {
    expect(() => pipe.transform("not-an-object", metadata("body"))).toThrow(/요청 본문 또는 URL/);
    expect(() => pipe.transform({ search: "x".repeat(2_049) }, metadata("query")))
      .toThrow(/요청 본문 또는 URL/);
    expect(() => pipe.transform({ nested: { constructor: "pollute" } }, metadata("body")))
      .toThrow(/요청 본문 또는 URL/);
  });
});
