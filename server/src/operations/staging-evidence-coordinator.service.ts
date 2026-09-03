import { SOLO_RELEASE_OPERATOR_LOGIN } from "../common/release-approval-policy.js";
export const STAGING_EVIDENCE_CONFIRMATION = "RUN_STAGING_RELEASE_EVIDENCE";
export const STAGING_EVIDENCE_MAX_AGE_HOURS = 168;
export const STAGING_EVIDENCE_SECRET_NAMES = [
  "STAGING_API_BASE_URL",
  "STAGING_OPERATIONS_METRICS_TOKEN",
] as const;

export const STAGING_EVIDENCE_WORKFLOWS = [
  {
    name: "Staging read-only load test",
    file: "staging-read-only-load.yml",
    kind: "readOnlyLoad",
  },
  {
    name: "Staging worker queue soak",
    file: "staging-worker-soak.yml",
    kind: "workerSoak",
  },
] as const;

export type StagingEvidenceRun = {
  databaseId: number;
  workflowName: string;
  headSha: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
};

export type StagingEvidenceCoordinatorInput = {
  repository: string;
  actorLogin: string;
  defaultBranch: string;
  localCommitSha: string;
  remoteDefaultCommitSha: string;
  dirtyFileCount: number;
  repositorySecretNames: string[];
  runs: StagingEvidenceRun[];
  applyRequested: boolean;
  confirmation: string | null;
};

export type StagingEvidenceCoordinatorReport = {
  ok: boolean;
  mode: "dry-run" | "apply";
  repository: string;
  candidateCommitSha: string;
  defaultBranch: string;
  stage: "blocked" | "ready" | "in-progress" | "complete";
  checks: Array<{ name: string; status: "pass" | "fail"; code: string }>;
  evidence: Array<{
    kind: typeof STAGING_EVIDENCE_WORKFLOWS[number]["kind"];
    workflow: string;
    runId: number | null;
    state: "missing" | "in-progress" | "passed";
  }>;
  actions: Array<{ workflow: string; file: string }>;
  applyAuthorized: boolean;
};

type CoordinatorCheck = StagingEvidenceCoordinatorReport["checks"][number];

function coordinatorError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function check(name: string, passed: boolean, code: string): CoordinatorCheck {
  return { name, status: passed ? "pass" : "fail", code: passed ? "OK" : code };
}

function validRepository(value: string): boolean {
  const parts = value.split("/");
  return parts.length === 2 && parts.every((part) => (
    /^[A-Za-z0-9_.-]{1,100}$/u.test(part) && part !== "." && part !== ".."
  ));
}

function validBranch(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/u.test(value)
    && !value.includes("..")
    && !value.includes("//")
    && !value.endsWith("/")
    && !value.endsWith(".");
}

function validLogin(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$/u.test(value);
}

function validRun(run: StagingEvidenceRun): boolean {
  return Number.isSafeInteger(run.databaseId)
    && run.databaseId > 0
    && STAGING_EVIDENCE_WORKFLOWS.some(({ name }) => name === run.workflowName)
    && /^[a-fA-F0-9]{40}$/u.test(run.headSha)
    && ["queued", "in_progress", "completed", "waiting", "pending", "requested"].includes(run.status)
    && (run.conclusion === null || /^[a-z_]{1,40}$/u.test(run.conclusion))
    && Number.isFinite(Date.parse(run.createdAt));
}

export class StagingEvidenceCoordinatorService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  plan(input: StagingEvidenceCoordinatorInput): StagingEvidenceCoordinatorReport {
    if (!validRepository(input.repository)) throw coordinatorError("STAGING_EVIDENCE_REPOSITORY_INVALID");
    if (!validLogin(input.actorLogin)) throw coordinatorError("STAGING_EVIDENCE_ACTOR_INVALID");
    if (!validBranch(input.defaultBranch)) throw coordinatorError("STAGING_EVIDENCE_BRANCH_INVALID");
    if (!/^[a-fA-F0-9]{40}$/u.test(input.localCommitSha)
        || !/^[a-fA-F0-9]{40}$/u.test(input.remoteDefaultCommitSha)) {
      throw coordinatorError("STAGING_EVIDENCE_COMMIT_INVALID");
    }
    if (!Number.isSafeInteger(input.dirtyFileCount) || input.dirtyFileCount < 0) {
      throw coordinatorError("STAGING_EVIDENCE_DIRTY_COUNT_INVALID");
    }
    if (input.runs.some((run) => !validRun(run))) throw coordinatorError("STAGING_EVIDENCE_RUN_INVALID");

    const candidateCommitSha = input.localCommitSha.toLowerCase();
    const nowMs = this.now().getTime();
    const maximumAgeMs = STAGING_EVIDENCE_MAX_AGE_HOURS * 60 * 60 * 1_000;
    const evidence = STAGING_EVIDENCE_WORKFLOWS.map(({ name, kind }) => {
      const candidateRuns = input.runs
        .filter((run) => run.workflowName === name && run.headSha.toLowerCase() === candidateCommitSha)
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
      const passed = candidateRuns.find((run) => run.status === "completed"
        && run.conclusion === "success"
        && nowMs >= Date.parse(run.createdAt)
        && nowMs - Date.parse(run.createdAt) <= maximumAgeMs);
      if (passed) return { kind, workflow: name, runId: passed.databaseId, state: "passed" as const };
      const active = candidateRuns.find((run) => run.status !== "completed");
      if (active) return { kind, workflow: name, runId: active.databaseId, state: "in-progress" as const };
      return { kind, workflow: name, runId: null, state: "missing" as const };
    });
    const actions = STAGING_EVIDENCE_WORKFLOWS
      .filter(({ kind }) => evidence.find((item) => item.kind === kind)?.state === "missing")
      .map(({ name, file }) => ({ workflow: name, file }));
    const requiredSecretNames = new Set(input.repositorySecretNames);
    const checks: CoordinatorCheck[] = [
      check(
        "soloOperator",
        input.actorLogin.toLowerCase() === SOLO_RELEASE_OPERATOR_LOGIN.toLowerCase(),
        "STAGING_EVIDENCE_SOLO_OPERATOR_MISMATCH",
      ),
      check(
        "candidatePublished",
        input.remoteDefaultCommitSha.toLowerCase() === candidateCommitSha,
        "STAGING_EVIDENCE_CANDIDATE_NOT_PUBLISHED",
      ),
      check("workingTree", input.dirtyFileCount === 0, "STAGING_EVIDENCE_WORKING_TREE_NOT_CLEAN"),
      ...STAGING_EVIDENCE_SECRET_NAMES.map((name) => check(
        `secret:${name}`,
        requiredSecretNames.has(name),
        "STAGING_EVIDENCE_SECRET_MISSING",
      )),
      check(
        "applyConfirmation",
        !input.applyRequested || input.confirmation === STAGING_EVIDENCE_CONFIRMATION,
        "STAGING_EVIDENCE_CONFIRMATION_REQUIRED",
      ),
    ];
    const ok = checks.every(({ status }) => status === "pass");
    const complete = evidence.every(({ state }) => state === "passed");
    const inProgress = evidence.some(({ state }) => state === "in-progress");

    return {
      ok,
      mode: input.applyRequested ? "apply" : "dry-run",
      repository: input.repository,
      candidateCommitSha,
      defaultBranch: input.defaultBranch,
      stage: complete ? "complete" : inProgress ? "in-progress" : ok ? "ready" : "blocked",
      checks,
      evidence,
      actions,
      applyAuthorized: input.applyRequested && ok && actions.length > 0,
    };
  }
}
