import { readFile, readdir } from "node:fs/promises";
import { extname } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = new URL("../", import.meta.url);
const STATIC_RESEND_WEBHOOK_SECRET = /\bwhsec_[A-Za-z0-9+/]{24,}={0,2}(?![A-Za-z0-9_+/=-])/gu;

async function sourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return sourceFiles(child);
    return extname(entry.name) === ".ts" ? [child] : [];
  }));
  return files.flat();
}

describe("secret fixture policy", () => {
  it("does not store provider-shaped Resend webhook secrets as static test literals", async () => {
    const violations: string[] = [];
    for (const file of await sourceFiles(SOURCE_ROOT)) {
      const source = await readFile(file, "utf8");
      if (STATIC_RESEND_WEBHOOK_SECRET.test(source)) violations.push(file.pathname);
      STATIC_RESEND_WEBHOOK_SECRET.lastIndex = 0;
    }

    expect(violations).toEqual([]);
  });
});
