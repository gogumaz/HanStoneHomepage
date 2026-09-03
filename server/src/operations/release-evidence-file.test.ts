import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readReleaseEvidenceFile } from "./release-evidence-file.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryFile(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "baduk-release-evidence-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "report.json");
  await writeFile(path, contents, "utf8");
  return path;
}

describe("readReleaseEvidenceFile", () => {
  it("hashes the exact accepted JSON bytes", async () => {
    const contents = '{"ok":true}\n';
    const result = await readReleaseEvidenceFile("preflight", await temporaryFile(contents));
    expect(result.value).toEqual({ ok: true });
    expect(result.sha256).toBe(createHash("sha256").update(contents).digest("hex"));
  });

  it("accepts a transport security artifact under the bounded JSON policy", async () => {
    const contents = '{"ok":true,"schemaVersion":2}\n';
    const result = await readReleaseEvidenceFile("transportSecurity", await temporaryFile(contents));

    expect(result.value).toEqual({ ok: true, schemaVersion: 2 });
    expect(result.sha256).toBe(createHash("sha256").update(contents).digest("hex"));
  });

  it("fails with sanitized codes for missing, malformed, and oversized evidence", async () => {
    await expect(readReleaseEvidenceFile("recovery", "missing-private-path.json")).rejects.toMatchObject({
      name: "RELEASE_RECOVERY_REPORT_READ_FAILED",
    });
    await expect(readReleaseEvidenceFile("readOnlyLoad", await temporaryFile("not-json"))).rejects.toMatchObject({
      name: "RELEASE_READONLYLOAD_REPORT_JSON_INVALID",
    });
    await expect(
      readReleaseEvidenceFile("workerSoak", await temporaryFile(`"${"x".repeat(1024 * 1024)}"`)),
    ).rejects.toMatchObject({ name: "RELEASE_WORKERSOAK_REPORT_TOO_LARGE" });
  });
});
