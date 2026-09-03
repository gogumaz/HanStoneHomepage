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
const requiredWebFiles = ["index.html", "app.html", "payment/success.html", "payment/fail.html"];
const validWebConfig = `window.APP_CONFIG=Object.freeze({
  apiBaseUrl:"https://api.example.com/api/v1",
  oauthEnabled:true,
  oauthProviders:Object.freeze(["naver","kakao","google"]),
  boardApiEnabled:true,
  lectureApiEnabled:true,
  demoRoleSwitcher:false,
  paymentProvider:"toss-payments",
  tossPayments:Object.freeze({
    mode:"live",
    clientKey:"live_gck_public_client_key",
    paymentMethodVariantKey:"DEFAULT",
    agreementVariantKey:"AGREEMENT"
  })
});\n`;
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

async function webFixture(config = validWebConfig): Promise<{ project: string; dist: string }> {
  const project = await mkdtemp(join(tmpdir(), "baduk-artifacts-"));
  temporaryDirectories.push(project);
  const dist = join(project, "dist");
  await mkdir(join(dist, "payment"), { recursive: true });
  await Promise.all(requiredWebFiles.map((file) => writeFile(join(dist, file), "<!doctype html>\n")));
  await writeFile(join(dist, "config.js"), config);
  return { project, dist };
}

function verifyWeb(project: string) {
  return spawnSync(process.execPath, [script, "--profile", "web", "dist"], {
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

  it("accepts a public-only web runtime configuration", async () => {
    const { project } = await webFixture();
    const result = verifyWeb(project);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      profile: "web",
      webConfigValidated: true,
    });
  });

  it("rejects a missing or malformed web runtime configuration", async () => {
    const missing = await webFixture();
    await rm(join(missing.dist, "config.js"));
    const missingResult = verifyWeb(missing.project);

    const malformed = await webFixture("window.APP_CONFIG={apiBaseUrl:'http://api.example.com'};\n");
    const malformedResult = verifyWeb(malformed.project);

    expect(missingResult.status).toBe(1);
    expect(JSON.parse(missingResult.stderr).errorType).toBe("ARTIFACT_ENTRYPOINT_MISSING");
    expect(malformedResult.status).toBe(1);
    expect(JSON.parse(malformedResult.stderr).errorType).toBe("ARTIFACT_WEB_CONFIG_INVALID");
  });

  it("rejects server secrets and mismatched Toss key modes in web configuration", async () => {
    const secret = await webFixture(validWebConfig.replace(
      "paymentProvider:\"toss-payments\",",
      "paymentProvider:\"toss-payments\",paymentSecret:\"live_gsk_private_key\",",
    ));
    const secretResult = verifyWeb(secret.project);

    const mismatch = await webFixture(validWebConfig.replace("live_gck_public_client_key", "test_gck_public_client_key"));
    const mismatchResult = verifyWeb(mismatch.project);

    expect(secretResult.status).toBe(1);
    expect(JSON.parse(secretResult.stderr).errorType).toBe("ARTIFACT_WEB_CONFIG_SECRET_FOUND");
    expect(mismatchResult.status).toBe(1);
    expect(JSON.parse(mismatchResult.stderr).errorType).toBe("ARTIFACT_WEB_CONFIG_INVALID");
  });
});
