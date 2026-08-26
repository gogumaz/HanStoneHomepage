import { ApiError } from "../common/api-error.js";
import {
  optionalString,
  readInputObject,
  requiredInteger,
  requiredString,
  requiredTrue,
} from "../common/input-validation.js";
import {
  CONSULTATION_CATEGORIES,
  type ConsultationInput,
} from "./consultation.types.js";

const INPUT_KEYS = [
  "category",
  "organizationName",
  "contactName",
  "phone",
  "email",
  "expectedStudents",
  "title",
  "content",
  "privacyConsent",
] as const;

const CODE = "CONSULTATION_INPUT_INVALID";
const MESSAGE = "상담 신청 내용을 확인해 주세요.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const PHONE_PATTERN = /^[0-9+() -]+$/u;

export function validateConsultationInput(body: unknown): ConsultationInput {
  const input = readInputObject(body, INPUT_KEYS, CODE, MESSAGE);
  const category = requiredString(input, "category", { maxLength: 30 }, CODE, MESSAGE);
  if (!(CONSULTATION_CATEGORIES as readonly string[]).includes(category)) {
    throw new ApiError(CODE, MESSAGE, 400);
  }
  const phone = requiredString(
    input,
    "phone",
    { minLength: 8, maxLength: 30, pattern: PHONE_PATTERN },
    CODE,
    MESSAGE,
  );
  const digitCount = phone.replace(/\D/gu, "").length;
  if (digitCount < 8 || digitCount > 15) throw new ApiError(CODE, MESSAGE, 400);
  requiredTrue(input, "privacyConsent", "CONSULTATION_PRIVACY_CONSENT_REQUIRED", "개인정보 수집 및 이용 동의가 필요합니다.");

  return {
    category,
    organizationName: requiredString(input, "organizationName", { minLength: 2, maxLength: 100 }, CODE, MESSAGE),
    contactName: requiredString(input, "contactName", { minLength: 2, maxLength: 50 }, CODE, MESSAGE),
    phone,
    email: optionalString(input, "email", { maxLength: 254, pattern: EMAIL_PATTERN }, CODE, MESSAGE),
    expectedStudents: requiredInteger(input, "expectedStudents", 1, 10_000, CODE, MESSAGE),
    title: requiredString(input, "title", { minLength: 2, maxLength: 120 }, CODE, MESSAGE),
    content: requiredString(input, "content", { minLength: 10, maxLength: 2_000 }, CODE, MESSAGE),
  };
}
