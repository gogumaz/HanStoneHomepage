import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from "@nestjs/common";
import { ApiError } from "./api-error.js";
import type { ApiRequest, ApiResponse } from "./http-types.js";

const STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  429: "TOO_MANY_REQUESTS",
  503: "SERVICE_UNAVAILABLE",
};

function isPayloadTooLargeError(exception: unknown): boolean {
  if (!exception || typeof exception !== "object") return false;
  const candidate = exception as { status?: unknown; statusCode?: unknown; type?: unknown };
  return candidate.type === "entity.too.large"
    && (candidate.status === HttpStatus.PAYLOAD_TOO_LARGE
      || candidate.statusCode === HttpStatus.PAYLOAD_TOO_LARGE);
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<ApiRequest>();
    const response = context.getResponse<ApiResponse>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : isPayloadTooLargeError(exception)
        ? HttpStatus.PAYLOAD_TOO_LARGE
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let code = STATUS_CODES[status] ?? "INTERNAL_SERVER_ERROR";
    let message = status === HttpStatus.INTERNAL_SERVER_ERROR
      ? "서버에서 요청을 처리하지 못했습니다."
      : "요청을 처리할 수 없습니다.";

    if (exception instanceof ApiError) {
      code = exception.code;
      message = exception.message;
    } else if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
      message = "요청 본문이 허용된 크기를 초과했습니다.";
    } else if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      if (typeof payload === "string") {
        message = payload;
      } else if (payload && typeof payload === "object" && "message" in payload) {
        const value = payload.message;
        message = Array.isArray(value) ? value.join(", ") : String(value);
      }
    }

    response.status(status).json({
      error: {
        code,
        message,
        requestId: request.requestId ?? "req_unknown",
      },
    });
  }
}
