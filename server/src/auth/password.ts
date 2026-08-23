import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  return `scrypt$v1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, version, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "scrypt" || version !== "v1" || !saltValue || !hashValue) {
    return false;
  }

  try {
    const salt = Buffer.from(saltValue, "base64url");
    const stored = Buffer.from(hashValue, "base64url");
    if (stored.length !== KEY_LENGTH) {
      return false;
    }
    const candidate = await scrypt(password, salt, KEY_LENGTH) as Buffer;
    return timingSafeEqual(stored, candidate);
  } catch {
    return false;
  }
}
