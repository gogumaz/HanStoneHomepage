import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const MAX_SBOM_BYTES = 25 * 1024 * 1024;

function fail(code) {
  const error = new Error(code);
  error.name = code;
  throw error;
}

async function readSbom(name, path) {
  const contents = await readFile(path);
  if (contents.byteLength > MAX_SBOM_BYTES) fail("SUPPLY_CHAIN_SBOM_TOO_LARGE");
  let document;
  try {
    document = JSON.parse(contents.toString("utf8"));
  } catch {
    fail("SUPPLY_CHAIN_SBOM_JSON_INVALID");
  }
  if (
    document?.bomFormat !== "CycloneDX"
    || typeof document.specVersion !== "string"
    || !Array.isArray(document.components)
  ) {
    fail("SUPPLY_CHAIN_SBOM_FORMAT_INVALID");
  }
  return {
    name,
    sha256: createHash("sha256").update(contents).digest("hex"),
    componentCount: document.components.length,
    specVersion: document.specVersion,
  };
}

async function main() {
  const [webPath, apiPath, outputPath] = process.argv.slice(2);
  const commitSha = process.env.SUPPLY_CHAIN_COMMIT_SHA?.trim().toLowerCase();
  if (!webPath || !apiPath || !outputPath) fail("SUPPLY_CHAIN_ARGUMENTS_INVALID");
  if (!commitSha || !/^[a-f0-9]{40}$/.test(commitSha)) fail("SUPPLY_CHAIN_COMMIT_SHA_INVALID");

  const [web, api] = await Promise.all([
    readSbom("web", webPath),
    readSbom("api", apiPath),
  ]);
  const manifest = {
    schemaVersion: 1,
    ok: true,
    commitSha,
    generatedAt: new Date().toISOString(),
    vulnerabilityPolicy: "npm-audit-production-high-critical-zero",
    artifacts: [web, api],
  };
  const destination = resolve(outputPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({ ok: true, artifactCount: manifest.artifacts.length })}\n`);
}

main().catch((error) => {
  const errorType = error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.name)
    ? error.name
    : "SUPPLY_CHAIN_MANIFEST_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
