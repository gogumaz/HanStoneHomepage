import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const AAD = Buffer.from("baduk-history:account-mail-token:v1", "utf8");

function keyFromBase64(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.byteLength !== 32) throw new Error("ACCOUNT_MAIL_ENCRYPTION_KEY_INVALID");
  return key;
}

export function encryptAccountMailToken(token: string, keyBase64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromBase64(keyBase64), iv);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptAccountMailToken(payload: string, keyBase64: string): string {
  const [version, ivValue, tagValue, encryptedValue, extra] = payload.split(".");
  if (version !== VERSION || !ivValue || !tagValue || !encryptedValue || extra) {
    throw new Error("ACCOUNT_MAIL_TOKEN_PAYLOAD_INVALID");
  }
  const iv = Buffer.from(ivValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  const encrypted = Buffer.from(encryptedValue, "base64url");
  if (iv.byteLength !== 12 || tag.byteLength !== 16 || encrypted.byteLength === 0) {
    throw new Error("ACCOUNT_MAIL_TOKEN_PAYLOAD_INVALID");
  }
  const decipher = createDecipheriv("aes-256-gcm", keyFromBase64(keyBase64), iv);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
