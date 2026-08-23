import { createHash, randomBytes } from "node:crypto";

export function generateOAuthSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOAuthSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function normalizeReturnTo(value: unknown): string {
  if (typeof value !== "string") return "/";
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return "/";
  try {
    const url = new URL(candidate, "https://local.invalid");
    if (url.origin !== "https://local.invalid") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
