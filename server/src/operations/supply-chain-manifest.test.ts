import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const script = resolve(process.cwd(), "scripts/create-supply-chain-manifest.mjs");
const temporaryDirectories: string[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "baduk-supply-chain-"));
  temporaryDirectories.push(directory);
  const web = join(directory, "web.cdx.json");
  const api = join(directory, "api.cdx.json");
  const output = join(directory, "manifest.json");
  const document = JSON.stringify({
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    components: [{ name: "component" }],
  });
  await Promise.all([writeFile(web, document), writeFile(api, document)]);
  return { web, api, output, document };
}

function createManifest(paths: Awaited<ReturnType<typeof fixture>>, commitSha: string) {
  return spawnSync(process.execPath, [script, paths.web, paths.api, paths.output], {
    encoding: "utf8",
    env: { ...process.env, SUPPLY_CHAIN_COMMIT_SHA: commitSha },
  });
}

afterEach(async () => {
  const systemTemp = resolve(tmpdir());
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    const target = resolve(directory);
    if (!target.startsWith(`${systemTemp}${sep}`) || !target.includes("baduk-supply-chain-")) {
      throw new Error("TEST_TEMP_PATH_INVALID");
    }
    await rm(target, { recursive: true, force: true });
  }));
});

describe("supply-chain manifest CLI", () => {
  it("binds validated SBOM hashes to an immutable candidate commit", async () => {
    const paths = await fixture();
    const commitSha = "a".repeat(40);
    const result = createManifest(paths, commitSha);
    const manifest = JSON.parse(await readFile(paths.output, "utf8"));

    expect(result.status).toBe(0);
    expect(manifest).toMatchObject({
      ok: true,
      commitSha,
      vulnerabilityPolicy: "npm-audit-production-high-critical-zero",
      artifacts: [
        { name: "web", componentCount: 1, specVersion: "1.5" },
        { name: "api", componentCount: 1, specVersion: "1.5" },
      ],
    });
    expect(manifest.generatedAt).toEqual(expect.any(String));
    expect(Number.isFinite(Date.parse(manifest.generatedAt))).toBe(true);
    expect(manifest.artifacts[0].sha256).toBe(
      createHash("sha256").update(paths.document).digest("hex"),
    );
  });

  it("rejects mutable candidate identifiers", async () => {
    const paths = await fixture();
    const result = createManifest(paths, "main");

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      ok: false,
      errorType: "SUPPLY_CHAIN_COMMIT_SHA_INVALID",
    });
  });
});
