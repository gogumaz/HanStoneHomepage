import { HttpStatus, Injectable, type ArgumentMetadata, type PipeTransform } from "@nestjs/common";
import { ApiError } from "./api-error.js";

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const MAX_DEPTH = 20;
const MAX_PARAMETER_LENGTH = 200;
const MAX_QUERY_VALUE_LENGTH = 2_048;

function invalid(): never {
  throw new ApiError(
    "INPUT_BOUNDARY_INVALID",
    "요청 본문 또는 URL 입력값을 확인해 주세요.",
    HttpStatus.BAD_REQUEST,
  );
}

function assertSafeValue(value: unknown, depth: number, maxStringLength: number): void {
  if (depth > MAX_DEPTH) invalid();
  if (typeof value === "string") {
    if (value.length > maxStringLength || CONTROL_CHARACTERS.test(value)) invalid();
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid();
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertSafeValue(item, depth + 1, maxStringLength);
    return;
  }
  if (typeof value !== "object") invalid();
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key) || CONTROL_CHARACTERS.test(key)) invalid();
    assertSafeValue(item, depth + 1, maxStringLength);
  }
}

@Injectable()
export class ApiInputBoundaryPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type === "param") {
      if (
        typeof value !== "string"
        || value.length < 1
        || value.length > MAX_PARAMETER_LENGTH
        || CONTROL_CHARACTERS.test(value)
      ) invalid();
      return value;
    }
    if (metadata.type === "body" && value !== undefined) {
      if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
      assertSafeValue(value, 0, 100_000);
    }
    if (metadata.type === "query" && value !== undefined) {
      if (metadata.data !== undefined) {
        assertSafeValue(value, 0, MAX_QUERY_VALUE_LENGTH);
        return value;
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
      assertSafeValue(value, 0, MAX_QUERY_VALUE_LENGTH);
    }
    return value;
  }
}
