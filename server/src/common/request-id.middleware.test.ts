import { describe, expect, it, vi } from "vitest";
import type { ApiRequest, ApiResponse } from "./http-types.js";
import { RequestIdMiddleware } from "./request-id.middleware.js";

function run(headers: ApiRequest["headers"]) {
  const request: ApiRequest = { headers };
  const setHeader = vi.fn();
  const response = { setHeader } as unknown as ApiResponse;
  const next = vi.fn();

  new RequestIdMiddleware().use(request, response, next);
  return { request, setHeader, next };
}

describe("RequestIdMiddleware", () => {
  it("keeps a safe incoming request id", () => {
    const result = run({ "x-request-id": "req_client_1234" });
    expect(result.request.requestId).toBe("req_client_1234");
    expect(result.setHeader).toHaveBeenCalledWith("x-request-id", "req_client_1234");
    expect(result.next).toHaveBeenCalledOnce();
  });

  it("replaces unsafe request ids", () => {
    const result = run({ "x-request-id": "bad id with spaces" });
    expect(result.request.requestId).toMatch(/^req_[0-9a-f-]{36}$/);
  });
});
