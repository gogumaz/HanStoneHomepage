import { HttpStatus } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import { optionalString, readInputObject, requiredString } from "../common/input-validation.js";

export const INQUIRY_CATEGORIES = ["회원", "학습", "교재", "결제", "기타"] as const;

export type InquiryInput = { category: string; title: string; content: string; attachmentId: string | null };

export function validateInquiryInput(body: unknown): InquiryInput {
  const code = "INQUIRY_INPUT_INVALID";
  const message = "문의 내용을 확인해 주세요.";
  const input = readInputObject(body, ["category", "title", "content", "attachment", "attachmentId"], code, message);
  const category = requiredString(input, "category", { maxLength: 30 }, code, message);
  if (!(INQUIRY_CATEGORIES as readonly string[]).includes(category)) {
    throw new ApiError(code, message, HttpStatus.BAD_REQUEST);
  }
  if (input.attachment !== undefined && input.attachment !== null && input.attachment !== "") {
    throw new ApiError(
      "INQUIRY_ATTACHMENT_NOT_SUPPORTED",
      "첨부파일은 안전한 업로드 기능이 활성화된 후 등록할 수 있습니다.",
      HttpStatus.BAD_REQUEST,
    );
  }
  return {
    category,
    title: requiredString(input, "title", { minLength: 2, maxLength: 120 }, code, message),
    content: requiredString(input, "content", { minLength: 10, maxLength: 4_000 }, code, message),
    attachmentId: optionalString(
      input,
      "attachmentId",
      { maxLength: 36, pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu },
      code,
      message,
    ),
  };
}
