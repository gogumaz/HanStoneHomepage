import { HttpStatus } from "@nestjs/common";
import { ApiError } from "./api-error.js";

export type InputRecord = Record<string, unknown>;

type StringOptions = {
  minLength?: number;
  maxLength: number;
  pattern?: RegExp;
};

function invalid(code: string, message: string): never {
  throw new ApiError(code, message, HttpStatus.BAD_REQUEST);
}

export function readInputObject(
  value: unknown,
  allowedKeys: readonly string[],
  code: string,
  message: string,
): InputRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(code, message);
  const record = value as InputRecord;
  const allowed = new Set(allowedKeys);
  if (Object.keys(record).some((key) => !allowed.has(key))) invalid(code, message);
  return record;
}

export function requiredString(
  record: InputRecord,
  key: string,
  options: StringOptions,
  code: string,
  message: string,
): string {
  const value = record[key];
  if (typeof value !== "string") invalid(code, message);
  const normalized = value.trim();
  if (
    normalized.length < (options.minLength ?? 1)
    || normalized.length > options.maxLength
    || (options.pattern && !options.pattern.test(normalized))
  ) invalid(code, message);
  return normalized;
}

export function optionalString(
  record: InputRecord,
  key: string,
  options: StringOptions,
  code: string,
  message: string,
): string | null {
  const value = record[key];
  if (value === undefined || value === null || value === "") return null;
  return requiredString(record, key, options, code, message);
}

export function requiredInteger(
  record: InputRecord,
  key: string,
  minimum: number,
  maximum: number,
  code: string,
  message: string,
): number {
  const value = record[key];
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalid(code, message);
  }
  return value as number;
}

export function requiredTrue(
  record: InputRecord,
  key: string,
  code: string,
  message: string,
): true {
  if (record[key] !== true) invalid(code, message);
  return true;
}
