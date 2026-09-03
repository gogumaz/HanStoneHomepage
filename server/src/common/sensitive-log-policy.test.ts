import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = new URL("../", import.meta.url);
const LOGGER_CALL = /(?:this\.)?logger\.(?:log|debug|verbose|warn|error)\s*\(([\s\S]*?)\);/gu;
const SENSITIVE_VALUE = /\b(?:password|token|authorization|cookie|encryptedToken|codeVerifier|clientSecret|smtpPassword)\b/iu;

async function sourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return sourceFiles(child);
    return extname(entry.name) === ".ts" && !entry.name.endsWith(".test.ts") ? [child] : [];
  }));
  return files.flat();
}

describe("sensitive application log policy", () => {
  it("never passes password, token, cookie, or authorization values to application loggers", async () => {
    const violations: string[] = [];
    for (const file of await sourceFiles(SOURCE_ROOT)) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(LOGGER_CALL)) {
        if (SENSITIVE_VALUE.test(match[1] ?? "")) {
          violations.push(`${join(file.pathname)}: ${match[0].replace(/\s+/gu, " ").slice(0, 180)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  }, 15_000);
});
