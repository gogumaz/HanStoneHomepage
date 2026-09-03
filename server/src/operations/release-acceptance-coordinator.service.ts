import {
  SOLO_RELEASE_CONFIRMATION,
  SOLO_RELEASE_OPERATOR_LOGIN,
} from "../common/release-approval-policy.js";
import { REQUIRED_PRODUCTION_SECRETS } from "./release-readiness.service.js";

export const RELEASE_ACCEPTANCE_EVIDENCE_MAX_AGE_HOURS = 168;

export type ReleaseAcceptanceCoordinatorRun = {
  databaseId: number;
  workflowName: string;
  displayTitle: string;
  headSha: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  artifactNames: string[];
};

export type ReleaseAcceptanceCoordinatorInput = {
  repository: string;
  actorLogin: string;
  defaultBranch: string;
  localCommitSha: string;
  remoteDefaultCommitSha: string;
  dirtyFileCount: number;
  productionSecretNames: string[];
  releaseId: string | null;
  imageReference: string | null;
  registryHost: string;
  backupCreatedAt: string | null;
  restoreStartedAt: string | null;
  runs: ReleaseAcceptanceCoordinatorRun[];
  applyRequested: boolean;
  confirmation: string | null;
};

export type ReleaseAcceptanceCoordinatorReport = {
  ok: boolean;
  mode: "dry-run" | "apply";
  repository: string;
  candidateCommitSha: string;
  defaultBranch: string;
  releaseId: string | null;
  stage: "blocked" | "ready" | "in-progress" | "complete";
  checks: Array<{ name: string; status: "pass" | "fail"; code: string }>;
  evidence: Array<{
    kind: "ci" | "readOnlyLoad" | "workerSoak";
    workflow: string;
    runId: number | null;
    state: "missing" | "passed";
  }>;
  acceptanceRunId: number | null;
  action: { workflow: "Release candidate acceptance"; file: "release-candidate-acceptance.yml" } | null;
  applyAuthorized: boolean;
};

type AcceptanceCheck = ReleaseAcceptanceCoordinatorReport["checks"][number];

const evidenceContracts = [
  {
    kind: "ci",
    workflow: "CI",
    artifacts: (sha: string, runId: number) => [
      `release-supply-chain-${sha}`,
      `web-release-${sha}`,
      `browser-field-validation-${runId}`,
    ],
  },
  {
    kind: "readOnlyLoad",
    workflow: "Staging read-only load test",
    artifacts: (_sha: string, runId: number) => [`staging-read-only-load-report-${runId}`],
  },
  {
    kind: "workerSoak",
    workflow: "Staging worker queue soak",
    artifacts: (_sha: string, runId: number) => [`staging-worker-soak-report-${runId}`],
  },
] as const;

function coordinatorError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function check(name: string, passed: boolean, code: string): AcceptanceCheck {
  return { name, status: passed ? "pass" : "fail", code: passed ? "OK" : code };
}

function validRepository(value: string): boolean {
  const parts = value.split("/");
  return parts.length === 2 && parts.every((part) => (
    /^[A-Za-z0-9_.-]{1,100}$/u.test(part) && part !== "." && part !== ".."
  ));
}

function validLogin(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$/u.test(value);
}

function validBranch(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/u.test(value)
    && !value.includes("..") && !value.includes("//") && !value.endsWith("/") && !value.endsWith(".");
}

function validRun(run: ReleaseAcceptanceCoordinatorRun): boolean {
  return Number.isSafeInteger(run.databaseId) && run.databaseId > 0
    && ["CI", "Staging read-only load test", "Staging worker queue soak", "Release candidate acceptance"]
      .includes(run.workflowName)
    && run.displayTitle.length > 0 && run.displayTitle.length <= 256
    && /^[a-fA-F0-9]{40}$/u.test(run.headSha)
    && ["queued", "in_progress", "completed", "waiting", "pending", "requested"].includes(run.status)
    && (run.conclusion === null || /^[a-z_]{1,40}$/u.test(run.conclusion))
    && Number.isFinite(Date.parse(run.createdAt))
    && run.artifactNames.every((name) => /^[A-Za-z0-9_.-]{1,200}$/u.test(name));
}

function validRegistryHost(value: string): boolean {
  return /^[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/u.test(value) && !value.includes("..");
}

function validImageReference(value: string | null, registryHost: string): boolean {
  return value !== null
    && value.startsWith(`${registryHost}/`)
    && /^[A-Za-z0-9.-]+(?::[0-9]{1,5})?\/[A-Za-z0-9._/-]+@sha256:[a-f0-9]{64}$/u.test(value)
    && !value.includes("..");
}

export class ReleaseAcceptanceCoordinatorService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  plan(input: ReleaseAcceptanceCoordinatorInput): ReleaseAcceptanceCoordinatorReport {
    if (!validRepository(input.repository)) throw coordinatorError("RELEASE_ACCEPTANCE_REPOSITORY_INVALID");
    if (!validLogin(input.actorLogin)) throw coordinatorError("RELEASE_ACCEPTANCE_ACTOR_INVALID");
    if (!validBranch(input.defaultBranch)) throw coordinatorError("RELEASE_ACCEPTANCE_BRANCH_INVALID");
    if (!/^[a-fA-F0-9]{40}$/u.test(input.localCommitSha)
        || !/^[a-fA-F0-9]{40}$/u.test(input.remoteDefaultCommitSha)) {
      throw coordinatorError("RELEASE_ACCEPTANCE_COMMIT_INVALID");
    }
    if (!Number.isSafeInteger(input.dirtyFileCount) || input.dirtyFileCount < 0) {
      throw coordinatorError("RELEASE_ACCEPTANCE_DIRTY_COUNT_INVALID");
    }
    if (!validRegistryHost(input.registryHost)) throw coordinatorError("RELEASE_ACCEPTANCE_REGISTRY_INVALID");
    if (input.runs.some((run) => !validRun(run))) throw coordinatorError("RELEASE_ACCEPTANCE_RUN_INVALID");

    const candidateCommitSha = input.localCommitSha.toLowerCase();
    const nowMs = this.now().getTime();
    const maximumAgeMs = RELEASE_ACCEPTANCE_EVIDENCE_MAX_AGE_HOURS * 60 * 60 * 1_000;
    const evidence = evidenceContracts.map(({ kind, workflow, artifacts }) => {
      const passed = input.runs
        .filter((run) => run.workflowName === workflow
          && run.headSha.toLowerCase() === candidateCommitSha
          && run.status === "completed"
          && run.conclusion === "success"
          && nowMs >= Date.parse(run.createdAt)
          && nowMs - Date.parse(run.createdAt) <= maximumAgeMs
          && artifacts(candidateCommitSha, run.databaseId).every((name) => run.artifactNames.includes(name)))
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
      return { kind, workflow, runId: passed?.databaseId ?? null, state: passed ? "passed" as const : "missing" as const };
    });
    const expectedAcceptanceTitle = input.releaseId
      ? `Release candidate acceptance · ${input.releaseId}`
      : null;
    const acceptanceRuns = expectedAcceptanceTitle === null ? [] : input.runs
      .filter((run) => run.workflowName === "Release candidate acceptance"
        && run.headSha.toLowerCase() === candidateCommitSha
        && run.displayTitle === expectedAcceptanceTitle)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    const completedAcceptance = acceptanceRuns.find((run) => run.status === "completed" && run.conclusion === "success");
    const activeAcceptance = acceptanceRuns.find((run) => run.status !== "completed");
    const releaseIdValid = input.releaseId !== null && /^[A-Za-z0-9._-]{1,80}$/u.test(input.releaseId);
    const backupMs = input.backupCreatedAt === null ? Number.NaN : Date.parse(input.backupCreatedAt);
    const restoreMs = input.restoreStartedAt === null ? Number.NaN : Date.parse(input.restoreStartedAt);
    const secrets = new Set(input.productionSecretNames);
    const checks: AcceptanceCheck[] = [
      check(
        "soloOperator",
        input.actorLogin.toLowerCase() === SOLO_RELEASE_OPERATOR_LOGIN.toLowerCase(),
        "RELEASE_ACCEPTANCE_SOLO_OPERATOR_MISMATCH",
      ),
      check(
        "candidatePublished",
        input.remoteDefaultCommitSha.toLowerCase() === candidateCommitSha,
        "RELEASE_ACCEPTANCE_CANDIDATE_NOT_PUBLISHED",
      ),
      check("workingTree", input.dirtyFileCount === 0, "RELEASE_ACCEPTANCE_WORKING_TREE_NOT_CLEAN"),
      check(
        "input:releaseId",
        releaseIdValid,
        input.releaseId === null ? "RELEASE_ACCEPTANCE_RELEASE_ID_MISSING" : "RELEASE_ACCEPTANCE_RELEASE_ID_INVALID",
      ),
      check(
        "input:imageReference",
        validImageReference(input.imageReference, input.registryHost),
        input.imageReference === null ? "RELEASE_ACCEPTANCE_IMAGE_REFERENCE_MISSING" : "RELEASE_ACCEPTANCE_IMAGE_REFERENCE_INVALID",
      ),
      check(
        "input:backupCreatedAt",
        Number.isFinite(backupMs) && backupMs <= nowMs,
        input.backupCreatedAt === null ? "RELEASE_ACCEPTANCE_BACKUP_TIME_MISSING" : "RELEASE_ACCEPTANCE_BACKUP_TIME_INVALID",
      ),
      check(
        "input:restoreStartedAt",
        Number.isFinite(restoreMs) && restoreMs <= nowMs && restoreMs >= backupMs,
        input.restoreStartedAt === null ? "RELEASE_ACCEPTANCE_RESTORE_TIME_MISSING" : "RELEASE_ACCEPTANCE_RESTORE_TIME_INVALID",
      ),
      ...REQUIRED_PRODUCTION_SECRETS.map((name) => check(
        `secret:${name}`,
        secrets.has(name),
        "RELEASE_ACCEPTANCE_PRODUCTION_SECRET_MISSING",
      )),
      ...evidence.map(({ kind, state }) => check(
        `evidence:${kind}`,
        state === "passed",
        "RELEASE_ACCEPTANCE_EVIDENCE_MISSING",
      )),
      check(
        "applyConfirmation",
        !input.applyRequested || input.confirmation === SOLO_RELEASE_CONFIRMATION,
        "RELEASE_ACCEPTANCE_CONFIRMATION_REQUIRED",
      ),
    ];
    const ok = checks.every(({ status }) => status === "pass");
    const acceptanceRunId = completedAcceptance?.databaseId ?? activeAcceptance?.databaseId ?? null;
    const stage = completedAcceptance ? "complete" : activeAcceptance ? "in-progress" : ok ? "ready" : "blocked";
    const action = acceptanceRunId === null
      ? { workflow: "Release candidate acceptance" as const, file: "release-candidate-acceptance.yml" as const }
      : null;

    return {
      ok,
      mode: input.applyRequested ? "apply" : "dry-run",
      repository: input.repository,
      candidateCommitSha,
      defaultBranch: input.defaultBranch,
      releaseId: releaseIdValid ? input.releaseId : null,
      stage,
      checks,
      evidence,
      acceptanceRunId,
      action,
      applyAuthorized: input.applyRequested && ok && action !== null,
    };
  }
}
