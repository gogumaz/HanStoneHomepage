import { HttpStatus } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import { optionalString, readInputObject, requiredString, requiredTrue } from "../common/input-validation.js";
import { CommunityPostType } from "../generated/prisma/enums.js";

export const TRAVEL_PUBLICATION_CONSENT_VERSION = "community-travel-publication-v1";

const CLASS_TIP_CATEGORIES = ["수업설계", "바둑활동", "역사활동", "학급운영"] as const;
const TRAVEL_CATEGORIES = ["교실여행", "가정학습", "체험후기"] as const;
const TARGET_GRADES = ["초등 1~2학년", "초등 3~4학년", "초등 5~6학년", "전 학년"] as const;
const ERAS = ["선사시대", "고조선", "삼국시대", "고려", "조선", "근현대"] as const;
const BADUK_LEVELS = ["입문", "초급", "중급"] as const;
const CODE = "COMMUNITY_POST_INVALID";
const MESSAGE = "커뮤니티 게시글 입력 내용을 확인해 주세요.";

export function validateCommunityPostCreate(body: unknown, now = new Date()) {
  const input = readInputObject(
    body,
    ["type", "category", "title", "targetGrade", "era", "badukLevel", "className", "content", "consent", "attachment", "attachmentId"],
    CODE,
    MESSAGE,
  );
  rejectAttachment(input.attachment);
  const type = readType(input.type);
  const common = {
    type,
    title: requiredString(input, "title", { minLength: 2, maxLength: 160 }, CODE, MESSAGE),
    content: requiredString(input, "content", { minLength: 2, maxLength: 20_000 }, CODE, MESSAGE),
    era: oneOf(input, "era", ERAS),
    attachmentId: optionalString(input, "attachmentId", { maxLength: 36, pattern: UUID_PATTERN }, CODE, MESSAGE),
  };
  if (type === CommunityPostType.CLASS_TIP) {
    if (input.className !== undefined || input.consent !== undefined) invalid();
    return {
      ...common,
      category: oneOf(input, "category", CLASS_TIP_CATEGORIES),
      targetGrade: oneOf(input, "targetGrade", TARGET_GRADES),
      badukLevel: oneOf(input, "badukLevel", BADUK_LEVELS),
      className: null,
      publicationConsentVersion: null,
      publicationConsentedAt: null,
    };
  }
  if (input.targetGrade !== undefined || input.badukLevel !== undefined) invalid();
  requiredTrue(input, "consent", CODE, "여행기 공개 동의를 확인해 주세요.");
  return {
    ...common,
    category: oneOf(input, "category", TRAVEL_CATEGORIES),
    targetGrade: null,
    badukLevel: null,
    className: requiredString(input, "className", { minLength: 2, maxLength: 100 }, CODE, MESSAGE),
    publicationConsentVersion: TRAVEL_PUBLICATION_CONSENT_VERSION,
    publicationConsentedAt: now,
  };
}

export function validateCommunityPostUpdate(type: CommunityPostType, body: unknown) {
  const input = readInputObject(
    body,
    ["category", "title", "targetGrade", "era", "badukLevel", "className", "content", "consent", "attachment", "attachmentId"],
    CODE,
    MESSAGE,
  );
  rejectAttachment(input.attachment);
  const data = {
    ...(input.title !== undefined ? {
      title: requiredString(input, "title", { minLength: 2, maxLength: 160 }, CODE, MESSAGE),
    } : {}),
    ...(input.content !== undefined ? {
      content: requiredString(input, "content", { minLength: 2, maxLength: 20_000 }, CODE, MESSAGE),
    } : {}),
    ...(input.era !== undefined ? { era: oneOf(input, "era", ERAS) } : {}),
    ...(Object.hasOwn(input, "attachmentId") ? {
      attachmentId: optionalString(input, "attachmentId", { maxLength: 36, pattern: UUID_PATTERN }, CODE, MESSAGE),
    } : {}),
  };
  if (type === CommunityPostType.CLASS_TIP) {
    if (input.className !== undefined || input.consent !== undefined) invalid();
    Object.assign(data,
      input.category !== undefined ? { category: oneOf(input, "category", CLASS_TIP_CATEGORIES) } : {},
      input.targetGrade !== undefined ? { targetGrade: oneOf(input, "targetGrade", TARGET_GRADES) } : {},
      input.badukLevel !== undefined ? { badukLevel: oneOf(input, "badukLevel", BADUK_LEVELS) } : {},
    );
  } else {
    if (input.targetGrade !== undefined || input.badukLevel !== undefined) invalid();
    if (input.consent !== undefined) requiredTrue(input, "consent", CODE, "여행기 공개 동의를 확인해 주세요.");
    Object.assign(data,
      input.category !== undefined ? { category: oneOf(input, "category", TRAVEL_CATEGORIES) } : {},
      input.className !== undefined ? {
        className: requiredString(input, "className", { minLength: 2, maxLength: 100 }, CODE, MESSAGE),
      } : {},
    );
  }
  if (Object.keys(data).length === 0) invalid();
  return data;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function validateRejection(body: unknown) {
  const input = readInputObject(body, ["reason"], "COMMUNITY_REJECTION_INVALID", "반려 사유를 확인해 주세요.");
  return requiredString(
    input,
    "reason",
    { minLength: 2, maxLength: 500 },
    "COMMUNITY_REJECTION_INVALID",
    "반려 사유를 확인해 주세요.",
  );
}

export function readCommunityPostType(value: unknown): CommunityPostType {
  return readType(value);
}

function readType(value: unknown): CommunityPostType {
  if (value === "classTip") return CommunityPostType.CLASS_TIP;
  if (value === "travel") return CommunityPostType.TRAVEL;
  invalid();
}

function oneOf(input: Record<string, unknown>, key: string, values: readonly string[]) {
  const value = requiredString(input, key, { maxLength: 30 }, CODE, MESSAGE);
  if (!values.includes(value)) invalid();
  return value;
}

function rejectAttachment(value: unknown): void {
  if (value !== undefined && value !== null && value !== "") {
    throw new ApiError(
      "COMMUNITY_ATTACHMENT_NOT_SUPPORTED",
      "커뮤니티 첨부파일은 위치정보 제거와 안전 검사 기능 적용 후 지원됩니다.",
      HttpStatus.BAD_REQUEST,
    );
  }
}

function invalid(): never {
  throw new ApiError(CODE, MESSAGE, HttpStatus.BAD_REQUEST);
}
