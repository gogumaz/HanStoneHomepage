import { createHash } from "node:crypto";

export const ROLLBACK_CONFIRMATION = "AUTHORIZE_FORWARD_ONLY_IMAGE_ROLLBACK";

export type ReleaseRollbackPlanInput = {
  currentAcceptance: unknown;
  failedDeploymentVerification: unknown;
  targetCloseout: unknown;
  currentAcceptanceSha256: string;
  failedDeploymentVerificationSha256: string;
  targetCloseoutSha256: string;
  databaseStrategy: string;
  confirmation: string;
  maximumFailureAgeHours: number;
};

type Identity = {
  releaseId: string | null;
  commitSha: string | null;
  imageReference: string | null;
  imageDigest: string | null;
  webDeploymentManifestSha256: string | null;
};

export type ReleaseRollbackPlanReport = {
  ok: boolean;
  rollbackAuthorized: boolean;
  createdAt: string;
  current: Identity;
  target: Identity;
  databaseStrategy: "forward-only";
  artifacts: {
    currentAcceptanceSha256: string;
    failedDeploymentVerificationSha256: string;
    targetCloseoutSha256: string;
  };
  checks: Array<{ name: string; status: "pass" | "fail"; code: string }>;
  rollbackPlanSha256: string;
};

type JsonObject = Record<string, unknown>;
type RollbackCheck = ReleaseRollbackPlanReport["checks"][number];
const HASH = /^[a-fA-F0-9]{64}$/;

function rollbackError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function check(name: string, passed: boolean, code: string): RollbackCheck {
  return { name, status: passed ? "pass" : "fail", code: passed ? "OK" : code };
}

function time(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function webDeploymentManifestSha256(value: JsonObject | null): string | null {
  if (typeof value?.webDeploymentManifestSha256 === "string" && HASH.test(value.webDeploymentManifestSha256)) {
    return value.webDeploymentManifestSha256.toLowerCase();
  }
  if (!Array.isArray(value?.evidence)) return null;
  const matches = value.evidence.filter((item) => object(item)?.name === "webDeployment");
  const evidence = object(matches[0]);
  return matches.length === 1 && evidence?.status === "pass" && typeof evidence.sha256 === "string" && HASH.test(evidence.sha256)
    ? evidence.sha256.toLowerCase() : null;
}

function identity(value: JsonObject | null): Identity {
  const releaseId = typeof value?.releaseId === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(value.releaseId)
    ? value.releaseId : null;
  const commitSha = typeof value?.commitSha === "string" && /^[a-fA-F0-9]{40}$/.test(value.commitSha)
    ? value.commitSha.toLowerCase() : null;
  const imageDigest = typeof value?.imageDigest === "string" && /^sha256:[a-fA-F0-9]{64}$/.test(value.imageDigest)
    ? value.imageDigest.toLowerCase() : null;
  const imageReference = typeof value?.imageReference === "string" && imageDigest &&
    value.imageReference.toLowerCase().endsWith(`@${imageDigest}`) && !value.imageReference.includes("://")
    ? value.imageReference : null;
  return { releaseId, commitSha, imageReference, imageDigest, webDeploymentManifestSha256: webDeploymentManifestSha256(value) };
}

function complete(value: Identity): boolean {
  return Boolean(
    value.releaseId && value.commitSha && value.imageReference && value.imageDigest && value.webDeploymentManifestSha256,
  );
}

export class ReleaseRollbackPlanService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  run(input: ReleaseRollbackPlanInput): ReleaseRollbackPlanReport {
    if (![input.currentAcceptanceSha256, input.failedDeploymentVerificationSha256, input.targetCloseoutSha256]
      .every((value) => HASH.test(value))) {
      throw rollbackError("ROLLBACK_ARTIFACT_SHA256_INVALID");
    }
    if (!Number.isInteger(input.maximumFailureAgeHours) || input.maximumFailureAgeHours < 1 ||
      input.maximumFailureAgeHours > 168) {
      throw rollbackError("ROLLBACK_FAILURE_MAXIMUM_AGE_INVALID");
    }
    const acceptance = object(input.currentAcceptance);
    const failedDeployment = object(input.failedDeploymentVerification);
    const expected = object(failedDeployment?.expected);
    const failedWeb = object(failedDeployment?.web);
    const failedWebExpected = object(failedWeb?.expected);
    const targetCloseout = object(input.targetCloseout);
    const current = identity(acceptance);
    const target = identity(targetCloseout);
    const acceptedAt = time(acceptance?.checkedAt);
    const failedAt = time(failedDeployment?.completedAt);
    const targetClosedAt = time(targetCloseout?.closedAt);
    const now = this.now();
    const failureAgeHours = failedAt === null ? null : (now.getTime() - failedAt) / 3_600_000;
    const failureFresh = failureAgeHours !== null && failureAgeHours >= -(5 / 60) &&
      failureAgeHours <= input.maximumFailureAgeHours;
    const timelineValid = acceptedAt !== null && failedAt !== null && targetClosedAt !== null &&
      targetClosedAt < acceptedAt && acceptedAt <= failedAt;
    const targetDifferent = complete(current) && complete(target) &&
      current.commitSha !== target.commitSha && current.imageDigest !== target.imageDigest;
    const checks = [
      check("currentAcceptance", acceptance?.ok === true && complete(current), "ROLLBACK_CURRENT_ACCEPTANCE_INVALID"),
      check(
        "failedDeployment",
        failedDeployment?.ok === false && failedDeployment?.rollbackRecommended === true,
        "ROLLBACK_NOT_RECOMMENDED_BY_VERIFICATION",
      ),
      check(
        "failedCandidateIdentity",
        complete(current) && expected?.commitSha === current.commitSha && expected?.imageDigest === current.imageDigest &&
          failedWebExpected?.commitSha === current.commitSha &&
          failedWebExpected?.manifestSha256 === current.webDeploymentManifestSha256,
        "ROLLBACK_FAILED_CANDIDATE_MISMATCH",
      ),
      check("targetCloseout", targetCloseout?.ok === true && complete(target), "ROLLBACK_TARGET_CLOSEOUT_INVALID"),
      check("targetCloseoutDigest", typeof targetCloseout?.closeoutSha256 === "string" &&
        HASH.test(targetCloseout.closeoutSha256), "ROLLBACK_TARGET_CLOSEOUT_DIGEST_INVALID"),
      check("targetDifferent", targetDifferent, "ROLLBACK_TARGET_NOT_PREVIOUS_IMAGE"),
      check("timeline", timelineValid, "ROLLBACK_TIMELINE_INVALID"),
      check("failureFreshness", failureFresh, "ROLLBACK_FAILURE_EVIDENCE_EXPIRED"),
      check("databaseStrategy", input.databaseStrategy === "forward-only", "ROLLBACK_DATABASE_STRATEGY_INVALID"),
      check("confirmation", input.confirmation === ROLLBACK_CONFIRMATION, "ROLLBACK_CONFIRMATION_REQUIRED"),
    ];
    const artifacts = {
      currentAcceptanceSha256: input.currentAcceptanceSha256.toLowerCase(),
      failedDeploymentVerificationSha256: input.failedDeploymentVerificationSha256.toLowerCase(),
      targetCloseoutSha256: input.targetCloseoutSha256.toLowerCase(),
    };
    const createdAt = now.toISOString();
    const rollbackAuthorized = checks.every(({ status }) => status === "pass");
    const planSource = JSON.stringify({
      createdAt,
      current,
      target,
      databaseStrategy: "forward-only",
      artifacts,
      maximumFailureAgeHours: input.maximumFailureAgeHours,
      checks: checks.map(({ name, status }) => ({ name, status })),
    });
    return {
      ok: rollbackAuthorized,
      rollbackAuthorized,
      createdAt,
      current,
      target,
      databaseStrategy: "forward-only",
      artifacts,
      checks,
      rollbackPlanSha256: createHash("sha256").update(planSource, "utf8").digest("hex"),
    };
  }
}
