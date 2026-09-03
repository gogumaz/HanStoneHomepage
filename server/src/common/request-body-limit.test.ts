import { Body, Controller, Post } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiExceptionFilter } from "./api-exception.filter.js";
import { ApiResponseInterceptor } from "./api-response.interceptor.js";
import { configureRequestBodyParsers } from "./request-body-limit.js";
import { RequestIdMiddleware } from "./request-id.middleware.js";
import { listenForHttpTest } from "../test-utils/listen-test-app.js";

const received = vi.fn((body: unknown) => body);

@Controller("body-limit-test")
class BodyLimitTestController {
  @Post()
  receive(@Body() body: unknown) {
    return received(body);
  }
}

describe("request body size limit", () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BodyLimitTestController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    app.setGlobalPrefix("api/v1");
    const requestId = new RequestIdMiddleware();
    app.use(requestId.use.bind(requestId));
    configureRequestBodyParsers(app, 128);
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    baseUrl = await listenForHttpTest(app);
  });

  afterAll(async () => app.close());

  it("accepts JSON within the configured limit", async () => {
    const response = await fetch(`${baseUrl}/api/v1/body-limit-test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "small" }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: { message: "small" } });
    expect(received).toHaveBeenCalledOnce();
  });

  it("rejects oversized JSON before the controller runs", async () => {
    const response = await fetch(`${baseUrl}/api/v1/body-limit-test`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_body_limit_test",
      },
      body: JSON.stringify({ message: "x".repeat(256) }),
    });
    const payload = await response.json() as {
      error: { code: string; message: string; requestId: string };
    };

    expect(response.status).toBe(413);
    expect(payload.error).toEqual({
      code: "PAYLOAD_TOO_LARGE",
      message: "요청 본문이 허용된 크기를 초과했습니다.",
      requestId: "req_body_limit_test",
    });
    expect(received).toHaveBeenCalledOnce();
  });
});
