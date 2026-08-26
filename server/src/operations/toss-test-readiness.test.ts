import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const script = resolve(process.cwd(), "scripts/verify-toss-test-readiness.mjs");
const temporaryDirectories: string[] = [];

async function fixture(config: string, environment: string) {
  const directory = resolve(process.cwd(), `.toss-readiness-${process.pid}-${temporaryDirectories.length}`);
  temporaryDirectories.push(directory);
  await mkdir(directory, { recursive: false });
  const configPath = join(directory, "config.js");
  const environmentPath = join(directory, ".env");
  await Promise.all([
    writeFile(configPath, config, { mode: 0o600 }),
    writeFile(environmentPath, environment, { mode: 0o600 }),
  ]);
  return { configPath, environmentPath };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Toss test payment readiness command", () => {
  it("accepts test widget keys without printing either key", async () => {
    const clientKey = "test_gck_client_1234567890";
    const secretKey = "test_gsk_secret_1234567890";
    const files = await fixture(
      `window.APP_CONFIG=Object.freeze({tossPayments:Object.freeze({mode:"test",clientKey:"${clientKey}"})});`,
      `TOSS_PAYMENTS_SECRET_KEY=${secretKey}\n`,
    );
    const { stdout } = await execute(process.execPath, [script, files.configPath, files.environmentPath]);
    const report = JSON.parse(stdout) as { ok: boolean; checks: Array<{ status: string }> };

    expect(report.ok).toBe(true);
    expect(report.checks.every(({ status }) => status === "pass")).toBe(true);
    expect(stdout).not.toContain(clientKey);
    expect(stdout).not.toContain(secretKey);
  });

  it("fails closed for live keys and a browser-exposed secret", async () => {
    const files = await fixture(
      'window.APP_CONFIG={tossPayments:{mode:"test",clientKey:"live_gck_client_1234567890"}};/* test_gsk_leaked_1234567890 */',
      "TOSS_PAYMENTS_SECRET_KEY=live_gsk_secret_1234567890\n",
    );
    let stdout = "";
    try {
      await execute(process.execPath, [script, files.configPath, files.environmentPath]);
    } catch (error) {
      stdout = (error as { stdout: string }).stdout;
    }
    const report = JSON.parse(stdout) as { ok: boolean; checks: Array<{ name: string; code: string }> };

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "widgetClientKey", code: "TOSS_TEST_WIDGET_CLIENT_KEY_INVALID",
    }));
    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "browserSecretIsolation", code: "TOSS_SECRET_EXPOSED_TO_BROWSER",
    }));
    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "widgetSecretKey", code: "TOSS_TEST_WIDGET_SECRET_KEY_INVALID",
    }));
    expect(stdout).not.toContain("leaked_1234567890");
    expect(stdout).not.toContain("secret_1234567890");
  });

  it("accepts a test secret supplied through the server process environment", async () => {
    const clientKey = "test_gck_client_1234567890";
    const secretKey = "test_gsk_process_1234567890";
    const files = await fixture(
      `window.APP_CONFIG={tossPayments:{mode:"test",clientKey:"${clientKey}"}};`,
      "",
    );
    const { stdout } = await execute(process.execPath, [script, files.configPath], {
      env: { ...process.env, TOSS_PAYMENTS_SECRET_KEY: secretKey },
    });
    const report = JSON.parse(stdout) as { ok: boolean };

    expect(report.ok).toBe(true);
    expect(stdout).not.toContain(clientKey);
    expect(stdout).not.toContain(secretKey);
  });
});
