import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cliPath = resolve(process.cwd(), "src/payment-operations-secret.ts");

describe("payment operations secret CLI contract", () => {
  it("validates an ignored protected capture and transmits its value only through stdin", async () => {
    const source = await readFile(cliPath, "utf8");

    expect(source).toContain('gitExecutable, ["check-ignore", "-q", "--", relative]');
    expect(source).toContain('capture.contents.toString("base64")');
    expect(source).toContain('stdio: ["pipe", "ignore", "ignore"]');
    expect(source).toContain("capture?.contents.fill(0)");
    expect(source).toContain('["rev-parse", "HEAD"]');
    expect(source).toContain('"PAYMENT_SECRET_REMOTE_HEAD_READ_FAILED"');
    expect(source).not.toContain('"--body"');
  });

  it("pairs the temporary secret with a release marker and rolls back partial staging", async () => {
    const source = await readFile(cliPath, "utf8");

    expect(source).toContain('"secret", "set", PAYMENT_OPERATIONS_SECRET_NAME');
    expect(source).toContain('"variable", "set", PAYMENT_OPERATIONS_RELEASE_VARIABLE_NAME');
    expect(source).toContain('"secret", "delete", PAYMENT_OPERATIONS_SECRET_NAME');
    expect(source).toContain('"variable", "delete", PAYMENT_OPERATIONS_RELEASE_VARIABLE_NAME');
    expect(source).toContain("GH_PAYMENT_SECRET_ROLLBACK_FAILED");
  });
});
