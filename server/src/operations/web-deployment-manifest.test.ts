import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(process.cwd(), "scripts/create-web-deployment-manifest.mjs");
const temporaryDirectories: string[] = [];

async function fixture(assetName = "app-AbCd1234.js") {
  const parent = await mkdtemp(join(tmpdir(), "baduk-web-release-"));
  temporaryDirectories.push(parent);
  const dist = join(parent, "dist");
  await Promise.all([mkdir(join(dist, "assets"), { recursive: true }), mkdir(join(dist, "payment"), { recursive: true })]);
  const files = new Map([
    ["index.html", "<html>home</html>"],
    ["app.html", "<html>app</html>"],
    ["payment/success.html", "<html>success</html>"],
    ["payment/fail.html", "<html>fail</html>"],
    ["config.js", "window.APP_CONFIG = {};"],
    [`assets/${assetName}`, "export const ready = true;"],
  ]);
  await Promise.all([...files].map(([name, contents]) => writeFile(join(dist, name), contents, "utf8")));
  return { parent, dist, output: join(dist, "web-deployment-manifest.json"), files };
}

function createManifest(paths: Awaited<ReturnType<typeof fixture>>, commitSha: string) {
  return spawnSync(process.execPath, [script, paths.dist, paths.output], {
    cwd: paths.parent,
    encoding: "utf8",
    env: { ...process.env, WEB_RELEASE_COMMIT_SHA: commitSha },
  });
}

afterEach(async () => {
  const systemTemp = resolve(tmpdir());
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    const target = resolve(directory);
    if (!target.startsWith(`${systemTemp}${sep}`) || !target.includes("baduk-web-release-")) {
      throw new Error("TEST_TEMP_PATH_INVALID");
    }
    await rm(target, { recursive: true, force: true });
  }));
});

describe("web deployment manifest CLI", () => {
  it("binds exact web bytes and safe cache policies to the candidate commit", async () => {
    const paths = await fixture();
    const result = createManifest(paths, "a".repeat(40));
    const manifest = JSON.parse(await readFile(paths.output, "utf8"));

    expect(result.status).toBe(0);
    expect(manifest).toMatchObject({ schemaVersion: 1, ok: true, commitSha: "a".repeat(40) });
    expect(manifest.files).toHaveLength(paths.files.size);
    const index = manifest.files.find(({ path }: { path: string }) => path === "index.html");
    const asset = manifest.files.find(({ path }: { path: string }) => path.startsWith("assets/"));
    expect(index).toMatchObject({
      cacheControl: "public,max-age=0,must-revalidate",
      contentType: "text/html; charset=utf-8",
      sha256: createHash("sha256").update(paths.files.get("index.html")!).digest("hex"),
    });
    expect(asset).toMatchObject({
      cacheControl: "public,max-age=31536000,immutable",
      contentType: "text/javascript; charset=utf-8",
    });
    expect(JSON.stringify(manifest)).not.toContain(paths.parent);
  });

  it("rejects mutable commits and non-fingerprinted immutable assets", async () => {
    const mutable = await fixture();
    expect(createManifest(mutable, "main").status).toBe(1);

    const unsafeAsset = await fixture("app.js");
    const result = createManifest(unsafeAsset, "b".repeat(40));
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({ ok: false, errorType: "WEB_RELEASE_ASSET_NOT_FINGERPRINTED" });
  });
});
