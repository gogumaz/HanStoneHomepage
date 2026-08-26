import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const script = resolve(process.cwd(), "scripts/verify-release-artifacts.mjs");
const requiredApiFiles = [
  "main.js",
  "account-mail-worker.js",
  "inquiry-notification-worker.js",
  "video-scan-worker.js",
  "video-cleanup-worker.js",
  "hls-transcode-worker.js",
];
const temporaryDirectories: string[] = [];

async function fixture(): Promise<{ project: string; dist: string }> {
  const project = await mkdtemp(join(tmpdir(), "baduk-artifacts-"));
  temporaryDirectories.push(project);
  const dist = join(project, "dist");
  await mkdir(dist);
  await Promise.all(requiredApiFiles.map((file) => writeFile(join(dist, file), "export {};\n")));
  return { project, dist };
}

function verify(project: string) {
  return spawnSync(process.execPath, [script, "--profile", "api", "dist"], {
    cwd: project,
    encoding: "utf8",
  });
}

afterEach(async () => {
  const systemTemp = resolve(tmpdir());
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    const target = resolve(directory);
    if (!target.startsWith(`${systemTemp}${sep}`) || !target.includes("baduk-artifacts-")) {
      throw new Error("TEST_TEMP_PATH_INVALID");
    }
    await rm(target, { recursive: true, force: true });
  }));
});

describe("release artifact verifier CLI", () => {
  it("accepts the required API runtime inventory", async () => {
    const { project } = await fixture();
    const result = verify(project);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, profile: "api", fileCount: 6 });
  });

  it("rejects source maps and their compiled references", async () => {
    const first = await fixture();
    await writeFile(join(first.dist, "main.js.map"), "{}\n");
    const sourceMapFile = verify(first.project);

    const second = await fixture();
    await writeFile(join(second.dist, "main.js"), "//# sourceMappingURL=main.js.map\n");
    const sourceMapReference = verify(second.project);

    expect(sourceMapFile.status).toBe(1);
    expect(JSON.parse(sourceMapFile.stderr)).toEqual({
      ok: false,
      errorType: "ARTIFACT_FORBIDDEN_FILE_FOUND",
    });
    expect(sourceMapReference.status).toBe(1);
    expect(JSON.parse(sourceMapReference.stderr)).toEqual({
      ok: false,
      errorType: "ARTIFACT_SOURCE_MAP_REFERENCE_FOUND",
    });
  });
});
