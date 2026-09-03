import { createHash } from "node:crypto";
import {
  successfulDeploymentVerificationEvidenceValid,
} from "./deployment-verification.service.js";

type JsonObject = Record<string, unknown>;
type Check = { name: string; status: "pass" | "fail"; code: string };

export type RollbackRehearsalEvidenceInput = {
  drillId: string;
  environmentLabel: string;
  apiBaseUrl: string;
  webBaseUrl: string;
  maximumAgeHours: number;
  currentAcceptance: unknown;
  targetCloseout: unknown;
  deploymentVerification: unknown;
  sourceSha256: { currentAcceptance: string; targetCloseout: string; deploymentVerification: string };
};

export type RollbackRehearsalEvidenceReport = {
  schemaVersion: 1;
  ok: boolean;
  drillId: string;
  environment: "isolated-non-production";
  checkedAt: string;
  current: { releaseId: string | null; commitSha: string | null; imageDigest: string | null };
  target: {
    releaseId: string | null;
    commitSha: string | null;
    imageReference: string | null;
    imageDigest: string | null;
    webDeploymentManifestSha256: string | null;
  };
  checks: Check[];
  sources: RollbackRehearsalEvidenceInput["sourceSha256"];
  evidenceSha256: string;
};

const SHA256 = /^[a-fA-F0-9]{64}$/u;
const COMMIT = /^[a-fA-F0-9]{40}$/u;
const DIGEST = /^sha256:[a-fA-F0-9]{64}$/u;
const NON_PRODUCTION = /(^|[._-])(staging|stage|test|testing|sandbox|drill|rehearsal)([._-]|$)/iu;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

function evidenceError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function check(name: string, passed: boolean, code: string): Check {
  return { name, status: passed ? "pass" : "fail", code: passed ? "OK" : code };
}

function time(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonProductionOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
      && (url.pathname === "/" || url.pathname === "") && NON_PRODUCTION.test(url.hostname);
  } catch {
    return false;
  }
}

function text(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value.toLowerCase() : null;
}

function webManifest(value: JsonObject | null): string | null {
  return text(value?.webDeploymentManifestSha256, SHA256);
}

export class RollbackRehearsalEvidenceService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  create(input: RollbackRehearsalEvidenceInput): RollbackRehearsalEvidenceReport {
    if (!/^[A-Za-z0-9._-]{1,80}$/u.test(input.drillId)) throw evidenceError("ROLLBACK_REHEARSAL_DRILL_ID_INVALID");
    if (!Number.isInteger(input.maximumAgeHours) || input.maximumAgeHours < 1 || input.maximumAgeHours > 24 * 30) {
      throw evidenceError("ROLLBACK_REHEARSAL_MAXIMUM_AGE_INVALID");
    }
    if (!Object.values(input.sourceSha256).every((value) => SHA256.test(value))) {
      throw evidenceError("ROLLBACK_REHEARSAL_SOURCE_SHA256_INVALID");
    }
    const acceptance = object(input.currentAcceptance);
    const closeout = object(input.targetCloseout);
    const verification = object(input.deploymentVerification);
    const expected = object(verification?.expected);
    const web = object(verification?.web);
    const webExpected = object(web?.expected);
    const current = {
      releaseId: typeof acceptance?.releaseId === "string" ? acceptance.releaseId : null,
      commitSha: text(acceptance?.commitSha, COMMIT),
      imageDigest: text(acceptance?.imageDigest, DIGEST),
    };
    const targetDigest = text(closeout?.imageDigest, DIGEST);
    const targetReference = typeof closeout?.imageReference === "string" && targetDigest
      && closeout.imageReference.toLowerCase().endsWith(`@${targetDigest}`) && !closeout.imageReference.includes("://")
      ? closeout.imageReference : null;
    const target = {
      releaseId: typeof closeout?.releaseId === "string" ? closeout.releaseId : null,
      commitSha: text(closeout?.commitSha, COMMIT),
      imageReference: targetReference,
      imageDigest: targetDigest,
      webDeploymentManifestSha256: webManifest(closeout),
    };
    const acceptedAt = time(acceptance?.checkedAt);
    const targetClosedAt = time(closeout?.closedAt);
    const verifiedAt = time(verification?.completedAt);
    const nowMs = this.now().getTime();
    const maximumAgeMs = input.maximumAgeHours * 60 * 60 * 1_000;
    const samples = object(verification?.samples);
    const threshold = object(verification?.threshold);
    const webChecks = Array.isArray(web?.checks) ? web.checks.map(object) : [];
    const targetComplete = Boolean(target.releaseId && target.commitSha && target.imageReference
      && target.imageDigest && target.webDeploymentManifestSha256);
    const checks: Check[] = [
      check(
        "isolatedEnvironment",
        NON_PRODUCTION.test(input.environmentLabel) && nonProductionOrigin(input.apiBaseUrl)
          && nonProductionOrigin(input.webBaseUrl),
        "ROLLBACK_REHEARSAL_ENVIRONMENT_NOT_ISOLATED",
      ),
      check(
        "currentAcceptance",
        acceptance?.ok === true && current.releaseId !== null && current.commitSha !== null && current.imageDigest !== null,
        "ROLLBACK_REHEARSAL_CURRENT_ACCEPTANCE_INVALID",
      ),
      check(
        "targetCloseout",
        closeout?.ok === true && targetComplete && typeof closeout?.closeoutSha256 === "string"
          && SHA256.test(closeout.closeoutSha256),
        "ROLLBACK_REHEARSAL_TARGET_CLOSEOUT_INVALID",
      ),
      check(
        "previousRelease",
        targetComplete && current.commitSha !== target.commitSha && current.imageDigest !== target.imageDigest,
        "ROLLBACK_REHEARSAL_TARGET_NOT_PREVIOUS_RELEASE",
      ),
      check(
        "deploymentIdentity",
        targetComplete && expected?.commitSha === target.commitSha && expected?.imageDigest === target.imageDigest
          && webExpected?.commitSha === target.commitSha
          && webExpected?.manifestSha256 === target.webDeploymentManifestSha256,
        "ROLLBACK_REHEARSAL_DEPLOYMENT_IDENTITY_MISMATCH",
      ),
      check(
        "deploymentHealth",
        verification?.ok === true && verification?.rollbackRecommended === false
          && target.releaseId !== null
          && successfulDeploymentVerificationEvidenceValid(verification, target.releaseId)
          && Number.isSafeInteger(samples?.planned) && Number(samples?.planned) > 0
          && samples?.completed === samples?.planned && samples?.failed === 0
          && threshold?.latencyMet === true && web?.ok === true && webChecks.length > 0
          && webChecks.every((entry) => entry?.status === "pass"),
        "ROLLBACK_REHEARSAL_DEPLOYMENT_VERIFICATION_INVALID",
      ),
      check(
        "timeline",
        targetClosedAt !== null && acceptedAt !== null && verifiedAt !== null
          && targetClosedAt < acceptedAt && acceptedAt <= verifiedAt
          && verifiedAt <= nowMs + MAX_CLOCK_SKEW_MS && nowMs - verifiedAt <= maximumAgeMs,
        "ROLLBACK_REHEARSAL_TIMELINE_INVALID_OR_EXPIRED",
      ),
    ];
    const checkedAt = this.now().toISOString();
    const sources = {
      currentAcceptance: input.sourceSha256.currentAcceptance.toLowerCase(),
      targetCloseout: input.sourceSha256.targetCloseout.toLowerCase(),
      deploymentVerification: input.sourceSha256.deploymentVerification.toLowerCase(),
    };
    const base = {
      schemaVersion: 1 as const,
      ok: checks.every(({ status }) => status === "pass"),
      drillId: input.drillId,
      environment: "isolated-non-production" as const,
      checkedAt,
      current,
      target,
      checks,
      sources,
    };
    return { ...base, evidenceSha256: createHash("sha256").update(JSON.stringify(base)).digest("hex") };
  }
}
