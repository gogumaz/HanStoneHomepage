import { HttpStatus } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import { optionalString, readInputObject, requiredString } from "../common/input-validation.js";
import {
  CommunityPostType,
  CommunityReportReason,
  CommunityReportStatus,
} from "../generated/prisma/enums.js";

const INVALID_CODE = "COMMUNITY_REPORT_INVALID";
const INVALID_MESSAGE = "신고 내용을 확인해 주세요.";

export function validateCommunityReport(body: unknown) {
  const input = readInputObject(body, ["reason", "detail"], INVALID_CODE, INVALID_MESSAGE);
  const reason = readReason(input.reason);
  const detail = optionalString(input, "detail", { minLength: 2, maxLength: 500 }, INVALID_CODE, INVALID_MESSAGE);
  if (reason === CommunityReportReason.OTHER && !detail) invalid();
  return { reason, detail };
}

export function validateReportResolution(body: unknown): "hide" | "dismiss" {
  const input = readInputObject(
    body,
    ["action"],
    "COMMUNITY_REPORT_RESOLUTION_INVALID",
    "신고 처리 방법을 확인해 주세요.",
  );
  const action = requiredString(
    input,
    "action",
    { maxLength: 20 },
    "COMMUNITY_REPORT_RESOLUTION_INVALID",
    "신고 처리 방법을 확인해 주세요.",
  );
  if (action !== "hide" && action !== "dismiss") {
    throw new ApiError(
      "COMMUNITY_REPORT_RESOLUTION_INVALID",
      "신고 처리 방법을 확인해 주세요.",
      HttpStatus.BAD_REQUEST,
    );
  }
  return action;
}

export function readCommunityReportStatus(value: unknown): CommunityReportStatus | undefined {
  const normalized = readQueryString(value, 20);
  if (!normalized || normalized === "all") return undefined;
  const statuses = {
    open: CommunityReportStatus.OPEN,
    resolved: CommunityReportStatus.RESOLVED,
    dismissed: CommunityReportStatus.DISMISSED,
  } as const;
  const status = statuses[normalized as keyof typeof statuses];
  if (!status) invalidFilter();
  return status;
}

export function readOptionalCommunityType(value: unknown): CommunityPostType | undefined {
  const normalized = readQueryString(value, 20);
  if (!normalized || normalized === "all") return undefined;
  if (normalized === "classTip") return CommunityPostType.CLASS_TIP;
  if (normalized === "travel") return CommunityPostType.TRAVEL;
  invalidFilter();
}

export function readReportPage(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/u.test(value)) invalidFilter();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) invalidFilter();
  return parsed;
}

function readReason(value: unknown): CommunityReportReason {
  const reasons = {
    spam: CommunityReportReason.SPAM,
    personal_info: CommunityReportReason.PERSONAL_INFO,
    harassment: CommunityReportReason.HARASSMENT,
    illegal: CommunityReportReason.ILLEGAL,
    copyright: CommunityReportReason.COPYRIGHT,
    other: CommunityReportReason.OTHER,
  } as const;
  if (typeof value !== "string") invalid();
  const reason = reasons[value as keyof typeof reasons];
  if (!reason) invalid();
  return reason;
}

function readQueryString(value: unknown, maxLength: number): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") invalidFilter();
  const normalized = value.trim();
  if (normalized.length > maxLength) invalidFilter();
  return normalized;
}

function invalid(): never {
  throw new ApiError(INVALID_CODE, INVALID_MESSAGE, HttpStatus.BAD_REQUEST);
}

function invalidFilter(): never {
  throw new ApiError("COMMUNITY_REPORT_FILTER_INVALID", "신고함 조회 조건을 확인해 주세요.", HttpStatus.BAD_REQUEST);
}
