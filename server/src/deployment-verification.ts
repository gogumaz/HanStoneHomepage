import "dotenv/config";
import { performance } from "node:perf_hooks";
import {
  DeploymentVerificationService,
  validateDeploymentTarget,
  type DeploymentProbe,
} from "./operations/deployment-verification.service.js";
import { parseReleaseIdentity } from "./operations/release-identity.js";
import { WebDeploymentVerificationService } from "./operations/web-deployment-verification.service.js";

function cliError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw cliError(`${name}_REQUIRED`);
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw cliError(`${name}_INVALID`);
  return value;
}

async function main(): Promise<void> {
  const baseUrl = validateDeploymentTarget(required("DEPLOY_VERIFY_BASE_URL"));
  const token = required("OPERATIONS_METRICS_TOKEN");
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) throw cliError("OPERATIONS_METRICS_TOKEN_INVALID");
  const probe: DeploymentProbe = async (timeoutMs) => {
    const startedAt = performance.now();
    const request = (path: string, authorization = false) => fetch(new URL(path, baseUrl), {
      method: "GET",
      headers: {
        accept: "application/json",
        ...(authorization ? { authorization: `Bearer ${token}` } : {}),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const [live, ready, identityResponse] = await Promise.all([
      request("/api/v1/health/live"),
      request("/api/v1/health/ready"),
      request("/api/v1/internal/release-identity", true),
    ]);
    if (identityResponse.status !== 200 ||
      !identityResponse.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw cliError(`DEPLOY_IDENTITY_HTTP_${identityResponse.status}`);
    }
    await Promise.all([live.body?.cancel(), ready.body?.cancel()]);
    const identityText = await identityResponse.text();
    if (Buffer.byteLength(identityText, "utf8") > 4_096) throw cliError("DEPLOY_IDENTITY_BODY_TOO_LARGE");
    let identityValue: unknown;
    try {
      identityValue = JSON.parse(identityText);
    } catch {
      throw cliError("DEPLOY_IDENTITY_JSON_INVALID");
    }
    const identity = parseReleaseIdentity(identityValue);
    return {
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      liveness: live.status === 200,
      readiness: ready.status === 200,
      identity,
    };
  };
  const apiReport = await new DeploymentVerificationService(probe).run({
    samples: integer("DEPLOY_VERIFY_SAMPLES", 3),
    intervalMs: integer("DEPLOY_VERIFY_INTERVAL_MS", 2_000),
    requestTimeoutMs: integer("DEPLOY_VERIFY_TIMEOUT_MS", 5_000),
    maximumP95Ms: integer("DEPLOY_VERIFY_MAX_P95_MS", 1_000),
    expectedCommitSha: required("DEPLOY_VERIFY_EXPECTED_COMMIT_SHA"),
    expectedImageDigest: required("DEPLOY_VERIFY_EXPECTED_IMAGE_DIGEST"),
  });
  const webBaseUrl = validateDeploymentTarget(required("DEPLOY_VERIFY_WEB_BASE_URL"));
  const webReport = await new WebDeploymentVerificationService().run({
    baseUrl: webBaseUrl,
    expectedCommitSha: required("DEPLOY_VERIFY_EXPECTED_COMMIT_SHA"),
    expectedManifestSha256: required("DEPLOY_VERIFY_EXPECTED_WEB_MANIFEST_SHA256"),
    requestTimeoutMs: integer("DEPLOY_VERIFY_TIMEOUT_MS", 5_000),
  });
  const report = {
    ...apiReport,
    ok: apiReport.ok && webReport.ok,
    rollbackRecommended: apiReport.rollbackRecommended || !webReport.ok,
    completedAt: webReport.checkedAt,
    web: webReport,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const errorType = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(error.name)
    ? error.name : "UNKNOWN";
  process.stderr.write(`${JSON.stringify({ ok: false, rollbackRecommended: true, errorType })}\n`);
  process.exitCode = 1;
});
