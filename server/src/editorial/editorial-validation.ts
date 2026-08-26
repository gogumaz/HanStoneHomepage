import { HttpStatus } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import { readInputObject, requiredInteger, requiredString } from "../common/input-validation.js";
import { EditorialContentStatus } from "../generated/prisma/enums.js";

export const NOTICE_CATEGORIES = ["서비스", "점검", "콘텐츠", "이벤트"] as const;
export const FAQ_CATEGORIES = ["회원", "학습", "교재", "결제", "기관"] as const;

const STATUS_VALUES = {
  draft: EditorialContentStatus.DRAFT,
  published: EditorialContentStatus.PUBLISHED,
  archived: EditorialContentStatus.ARCHIVED,
} as const;

const INVALID_CODE = "EDITORIAL_CONTENT_INVALID";
const INVALID_MESSAGE = "게시글 입력 내용을 확인해 주세요.";

export function validateNoticeCreate(body: unknown) {
  const input = readInputObject(
    body,
    ["category", "title", "content", "publishedAt", "isPinned", "attachment"],
    INVALID_CODE,
    INVALID_MESSAGE,
  );
  rejectAttachment(input.attachment);
  return {
    category: category(input, NOTICE_CATEGORIES),
    title: title(input),
    content: content(input),
    publishedAt: requiredDate(input.publishedAt),
    isPinned: optionalBoolean(input.isPinned, false),
  };
}

export function validateFaqCreate(body: unknown, now = new Date()) {
  const input = readInputObject(
    body,
    ["category", "title", "content", "displayOrder", "isPublished"],
    INVALID_CODE,
    INVALID_MESSAGE,
  );
  const published = optionalBoolean(input.isPublished, false);
  return {
    category: category(input, FAQ_CATEGORIES),
    title: title(input),
    content: content(input),
    displayOrder: requiredInteger(input, "displayOrder", 1, 10_000, INVALID_CODE, INVALID_MESSAGE),
    status: published ? EditorialContentStatus.PUBLISHED : EditorialContentStatus.DRAFT,
    publishedAt: published ? now : null,
  };
}

export function validateNoticeUpdate(body: unknown) {
  const input = readInputObject(
    body,
    ["category", "title", "content", "publishedAt", "isPinned", "status", "attachment"],
    INVALID_CODE,
    INVALID_MESSAGE,
  );
  rejectAttachment(input.attachment);
  const data = {
    ...(input.category !== undefined ? { category: category(input, NOTICE_CATEGORIES) } : {}),
    ...(input.title !== undefined ? { title: title(input) } : {}),
    ...(input.content !== undefined ? { content: content(input) } : {}),
    ...(input.publishedAt !== undefined ? { publishedAt: requiredDate(input.publishedAt) } : {}),
    ...(input.isPinned !== undefined ? { isPinned: optionalBoolean(input.isPinned, false) } : {}),
    ...(input.status !== undefined ? { status: status(input.status) } : {}),
  };
  requireChange(data);
  return data;
}

export function validateFaqUpdate(body: unknown, now = new Date()) {
  const input = readInputObject(
    body,
    ["category", "title", "content", "displayOrder", "isPublished", "status"],
    INVALID_CODE,
    INVALID_MESSAGE,
  );
  if (input.isPublished !== undefined && input.status !== undefined) invalid();
  const requestedStatus = input.status !== undefined
    ? status(input.status)
    : input.isPublished !== undefined
      ? (optionalBoolean(input.isPublished, false) ? EditorialContentStatus.PUBLISHED : EditorialContentStatus.DRAFT)
      : undefined;
  const data = {
    ...(input.category !== undefined ? { category: category(input, FAQ_CATEGORIES) } : {}),
    ...(input.title !== undefined ? { title: title(input) } : {}),
    ...(input.content !== undefined ? { content: content(input) } : {}),
    ...(input.displayOrder !== undefined ? {
      displayOrder: requiredInteger(input, "displayOrder", 1, 10_000, INVALID_CODE, INVALID_MESSAGE),
    } : {}),
    ...(requestedStatus !== undefined ? {
      status: requestedStatus,
      ...(requestedStatus === EditorialContentStatus.PUBLISHED ? { publishedAt: now } : {}),
    } : {}),
  };
  requireChange(data);
  return data;
}

function title(input: Record<string, unknown>) {
  return requiredString(input, "title", { minLength: 2, maxLength: 160 }, INVALID_CODE, INVALID_MESSAGE);
}

function content(input: Record<string, unknown>) {
  return requiredString(input, "content", { minLength: 2, maxLength: 20_000 }, INVALID_CODE, INVALID_MESSAGE);
}

function category(input: Record<string, unknown>, allowed: readonly string[]) {
  const value = requiredString(input, "category", { maxLength: 30 }, INVALID_CODE, INVALID_MESSAGE);
  if (!allowed.includes(value)) invalid();
  return value;
}

function optionalBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") invalid();
  return value;
}

function requiredDate(value: unknown): Date {
  if (typeof value !== "string") invalid();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value);
  if (!dateOnly && !isoDateTime) invalid();
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const calendarProbe = new Date(Date.UTC(year, month - 1, day));
    if (calendarProbe.getUTCFullYear() !== year || calendarProbe.getUTCMonth() !== month - 1
      || calendarProbe.getUTCDate() !== day) invalid();
  }
  const date = dateOnly ? new Date(`${value}T00:00:00+09:00`) : new Date(value);
  const declaredYear = Number(value.slice(0, 4));
  if (Number.isNaN(date.getTime()) || !Number.isInteger(declaredYear) || declaredYear < 2020 || declaredYear > 2100) invalid();
  return date;
}

function status(value: unknown): EditorialContentStatus {
  if (typeof value !== "string") invalid();
  const result = STATUS_VALUES[value as keyof typeof STATUS_VALUES];
  if (!result) invalid();
  return result;
}

function rejectAttachment(value: unknown): void {
  if (value !== undefined && value !== null && value !== "") {
    throw new ApiError(
      "EDITORIAL_ATTACHMENT_NOT_SUPPORTED",
      "공지 첨부파일은 아직 지원하지 않습니다.",
      HttpStatus.BAD_REQUEST,
    );
  }
}

function requireChange(data: object): void {
  if (Object.keys(data).length === 0) invalid();
}

function invalid(): never {
  throw new ApiError(INVALID_CODE, INVALID_MESSAGE, HttpStatus.BAD_REQUEST);
}
