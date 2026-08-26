import { createHash } from "node:crypto";
import { RELEASE_EVIDENCE_NAMES } from "./release-acceptance.service.js";

export type ReleaseCloseoutInput = {
  acceptance: unknown;
  deploymentVerification: unknown;
  acceptanceSha256: string;
  deploymentVerificationSha256: string;
  maximumVerificationDelayHours: number;
};

export type ReleaseCloseoutReport = {
  ok: boolean;
  releaseId: string | null;
  commitSha: string | null;
  imageReference: string | null;
  imageDigest: string | null;
  webDeploymentManifestSha256: string | null;
  acceptanceManifestSha256: string | null;
  closedAt: string;
  closeoutSha256: string;
  artifacts: {
    acceptanceSha256: string;
    deploymentVerificationSha256: string;
  };
  timeline: {
    acceptedAt: string | null;
    verifiedAt: string | null;
    verificationDelayMinutes: number | null;
    maximumVerificationDelayHours: number;
  };
  checks: Array<{ name: string; status: "pass" | "fail"; code: string }>;
};

type JsonObject = Record<string, unknown>;
type CloseoutCheck = ReleaseCloseoutReport["checks"][number];

const WEB_DEPLOYMENT_CHECK_NAMES = [
  "manifestSha256",
  "manifestSchema",
  "manifestCommit",
  "manifestCacheControl",
  "manifestContentType",
  "indexInventory",
  "assetInventory",
  "indexSha256",
  "indexCacheControl",
  "indexContentType",
  "assetSha256",
  "assetCacheControl",
  "assetContentType",
] as const;

function closeoutError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function check(name: string, passed: boolean, code: string): CloseoutCheck {
  return { name, status: passed ? "pass" : "fail", code: passed ? "OK" : code };
}

function timestamp(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
}

function allEvidencePassed(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== RELEASE_EVIDENCE_NAMES.length) return false;
  const expected = new Set<string>(RELEASE_EVIDENCE_NAMES);
  const names = value.map((item) => object(item)?.name);
  return names.every((name) => typeof name === "string" && expected.delete(name)) && expected.size === 0 &&
    value.every((item) => object(item)?.status === "pass");
}

function evidenceSha256(value: unknown, name: string): string | null {
  if (!Array.isArray(value)) return null;
  const matches = value.filter((item) => object(item)?.name === name);
  const sha256 = object(matches[0])?.sha256;
  return matches.length === 1 && typeof sha256 === "string" && /^[a-fA-F0-9]{64}$/.test(sha256)
    ? sha256.toLowerCase() : null;
}

function allWebChecksPassed(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== WEB_DEPLOYMENT_CHECK_NAMES.length) return false;
  const expected = new Set<string>(WEB_DEPLOYMENT_CHECK_NAMES);
  return value.every((item) => {
    const entry = object(item);
    return typeof entry?.name === "string" && expected.delete(entry.name) &&
      entry.status === "pass" && entry.code === "OK";
  }) && expected.size === 0;
}

export class ReleaseCloseoutService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  run(input: ReleaseCloseoutInput): ReleaseCloseoutReport {
    if (!Number.isInteger(input.maximumVerificationDelayHours) || input.maximumVerificationDelayHours < 1 ||
      input.maximumVerificationDelayHours > 168) {
      throw closeoutError("RELEASE_CLOSEOUT_MAXIMUM_DELAY_INVALID");
    }
    const artifactHashPattern = /^[a-fA-F0-9]{64}$/;
    if (!artifactHashPattern.test(input.acceptanceSha256) || !artifactHashPattern.test(input.deploymentVerificationSha256)) {
      throw closeoutError("RELEASE_CLOSEOUT_ARTIFACT_SHA256_INVALID");
    }

    const acceptance = object(input.acceptance);
    const deployment = object(input.deploymentVerification);
    const expected = object(deployment?.expected);
    const samples = object(deployment?.samples);
    const threshold = object(deployment?.threshold);
    const web = object(deployment?.web);
    const webExpected = object(web?.expected);
    const releaseId = typeof acceptance?.releaseId === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(acceptance.releaseId)
      ? acceptance.releaseId : null;
    const commitSha = typeof acceptance?.commitSha === "string" && /^[a-fA-F0-9]{40}$/.test(acceptance.commitSha)
      ? acceptance.commitSha.toLowerCase() : null;
    const imageDigest = typeof acceptance?.imageDigest === "string" && /^sha256:[a-fA-F0-9]{64}$/.test(acceptance.imageDigest)
      ? acceptance.imageDigest.toLowerCase() : null;
    const imageReference = typeof acceptance?.imageReference === "string" && imageDigest !== null &&
      acceptance.imageReference.toLowerCase().endsWith(`@${imageDigest}`) && !acceptance.imageReference.includes("://")
      ? acceptance.imageReference : null;
    const acceptanceManifestSha256 = typeof acceptance?.manifestSha256 === "string" &&
      artifactHashPattern.test(acceptance.manifestSha256) ? acceptance.manifestSha256.toLowerCase() : null;
    const acceptedWebManifestSha256 = evidenceSha256(acceptance?.evidence, "webDeployment");
    const accepted = timestamp(acceptance?.checkedAt);
    const verified = timestamp(deployment?.completedAt);
    const verificationDelayMinutes = accepted && verified
      ? Math.round(((verified.getTime() - accepted.getTime()) / 60_000) * 100) / 100 : null;
    const timelineOrdered = verificationDelayMinutes !== null && verificationDelayMinutes >= 0;
    const timelineWithinLimit = verificationDelayMinutes !== null &&
      verificationDelayMinutes <= input.maximumVerificationDelayHours * 60;
    const closedAtDate = this.now();
    const timelineNotFuture = Boolean(
      accepted && verified && accepted.getTime() <= closedAtDate.getTime() + 5 * 60_000 &&
      verified.getTime() <= closedAtDate.getTime() + 5 * 60_000,
    );

    const checks = [
      check("acceptance", acceptance?.ok === true, "RELEASE_ACCEPTANCE_NOT_SUCCESSFUL"),
      check("acceptanceEvidence", allEvidencePassed(acceptance?.evidence), "RELEASE_ACCEPTANCE_EVIDENCE_INCOMPLETE"),
      check("acceptanceManifest", acceptanceManifestSha256 !== null, "RELEASE_ACCEPTANCE_MANIFEST_INVALID"),
      check("acceptanceImageReference", imageReference !== null, "RELEASE_ACCEPTANCE_IMAGE_REFERENCE_INVALID"),
      check("deploymentVerification", deployment?.ok === true, "DEPLOYMENT_VERIFICATION_NOT_SUCCESSFUL"),
      check("rollbackDecision", deployment?.rollbackRecommended === false, "DEPLOYMENT_ROLLBACK_RECOMMENDED"),
      check(
        "deploymentSamples",
        Number.isSafeInteger(samples?.planned) && Number(samples?.planned) > 0 &&
          samples?.completed === samples?.planned && samples?.failed === 0,
        "DEPLOYMENT_VERIFICATION_INCOMPLETE",
      ),
      check("deploymentLatency", threshold?.latencyMet === true, "DEPLOYMENT_VERIFICATION_LATENCY_NOT_MET"),
      check(
        "deploymentHealth",
        samples?.livenessFailures === 0 && samples?.readinessFailures === 0 && samples?.identityMismatches === 0,
        "DEPLOYMENT_VERIFICATION_HEALTH_NOT_MET",
      ),
      check(
        "candidateIdentity",
        commitSha !== null && imageDigest !== null && expected?.commitSha === commitSha && expected?.imageDigest === imageDigest,
        "DEPLOYMENT_CANDIDATE_IDENTITY_MISMATCH",
      ),
      check(
        "webDeployment",
        web?.ok === true && allWebChecksPassed(web?.checks),
        "WEB_DEPLOYMENT_VERIFICATION_NOT_SUCCESSFUL",
      ),
      check(
        "webCandidateIdentity",
        commitSha !== null && acceptedWebManifestSha256 !== null && webExpected?.commitSha === commitSha &&
          webExpected?.manifestSha256 === acceptedWebManifestSha256,
        "WEB_DEPLOYMENT_CANDIDATE_IDENTITY_MISMATCH",
      ),
      check("timelineOrder", timelineOrdered, "DEPLOYMENT_VERIFICATION_BEFORE_ACCEPTANCE"),
      check("timelineDelay", timelineWithinLimit, "DEPLOYMENT_VERIFICATION_EXPIRED"),
      check("timelineFuture", timelineNotFuture, "DEPLOYMENT_VERIFICATION_TIMESTAMP_IN_FUTURE"),
    ];
    const closedAt = closedAtDate.toISOString();
    const artifacts = {
      acceptanceSha256: input.acceptanceSha256.toLowerCase(),
      deploymentVerificationSha256: input.deploymentVerificationSha256.toLowerCase(),
    };
    const closeoutSource = JSON.stringify({
      releaseId,
      commitSha,
      imageDigest,
      imageReference,
      webDeploymentManifestSha256: acceptedWebManifestSha256,
      acceptanceManifestSha256,
      closedAt,
      artifacts,
      maximumVerificationDelayHours: input.maximumVerificationDelayHours,
      checks: checks.map(({ name, status }) => ({ name, status })),
    });
    return {
      ok: checks.every(({ status }) => status === "pass"),
      releaseId,
      commitSha,
      imageReference,
      imageDigest,
      webDeploymentManifestSha256: acceptedWebManifestSha256,
      acceptanceManifestSha256,
      closedAt,
      closeoutSha256: createHash("sha256").update(closeoutSource, "utf8").digest("hex"),
      artifacts,
      timeline: {
        acceptedAt: accepted?.toISOString() ?? null,
        verifiedAt: verified?.toISOString() ?? null,
        verificationDelayMinutes,
        maximumVerificationDelayHours: input.maximumVerificationDelayHours,
      },
      checks,
    };
  }
}
