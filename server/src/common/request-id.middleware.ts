import { randomUUID } from "node:crypto";
import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { ApiRequest, ApiResponse, NextFunction } from "./http-types.js";

const SAFE_REQUEST_ID = /^[A-Za-z0-9_.:-]{8,100}$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: ApiRequest, response: ApiResponse, next: NextFunction): void {
    const incoming = request.headers["x-request-id"];
    const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
    const requestId = candidate && SAFE_REQUEST_ID.test(candidate)
      ? candidate
      : `req_${randomUUID()}`;

    request.requestId = requestId;
    response.setHeader("x-request-id", requestId);
    next();
  }
}
