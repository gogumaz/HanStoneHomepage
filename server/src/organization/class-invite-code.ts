import { createHash, randomBytes } from "node:crypto";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const NORMALIZED_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/u;

export function generateClassInviteCode(): string {
  const bytes = randomBytes(12);
  const normalized = Array.from(bytes, (byte) => CODE_ALPHABET[byte & 31]).join("");
  return normalized.match(/.{1,4}/gu)?.join("-") ?? normalized;
}

export function normalizeClassInviteCode(value: string): string {
  if (value.length > 64) return "";
  return value.trim().toUpperCase().replace(/[\s-]/gu, "");
}

export function isClassInviteCode(value: string): boolean {
  return NORMALIZED_CODE_PATTERN.test(normalizeClassInviteCode(value));
}

export function hashClassInviteCode(value: string): string {
  return createHash("sha256").update(normalizeClassInviteCode(value), "utf8").digest("hex");
}
