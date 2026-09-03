import { SOLO_RELEASE_OPERATOR_LOGIN } from "../common/release-approval-policy.js";

export const ROLLBACK_REHEARSAL_CONFIRMATION = "AUTHORIZE_ISOLATED_ROLLBACK_REHEARSAL";
export const ROLLBACK_REHEARSAL_SECRET_NAMES = [
  "ROLLBACK_DRILL_API_BASE_URL",
  "ROLLBACK_DRILL_WEB_BASE_URL",
  "ROLLBACK_DRILL_OPERATIONS_METRICS_TOKEN",
] as const;

export type RollbackRehearsalCoordinatorRun = {
  databaseId: number;
  workflowName: string;
  displayTitle: string;
  headSha: string;
  status: string;
  conclusion: string | null;
  artifactNames: string[];
};

export type RollbackRehearsalCoordinatorInput = {
  repository: string;
  actorLogin: string;
  defaultBranch: string;
  localCommitSha: string;
  remoteDefaultCommitSha: string;
  dirtyFileCount: number;
  workflowActive: boolean;
  repositorySecretNames: string[];
  drillId: string | null;
  currentReleaseId: string | null;
  currentAcceptanceRunId: number | null;
  targetReleaseId: string | null;
  targetCloseoutRunId: number | null;
  runs: RollbackRehearsalCoordinatorRun[];
  applyRequested: boolean;
  confirmation: string | null;
};

export type RollbackRehearsalCoordinatorReport = {
  ok: boolean;
  mode: "dry-run" | "apply";
  repository: string;
  candidateCommitSha: string;
  drillId: string | null;
  stage: "blocked" | "ready" | "in-progress" | "complete";
  currentAcceptanceRunId: number | null;
  targetCloseoutRunId: number | null;
  rehearsalRunId: number | null;
  checks: Array<{ name: string; status: "pass" | "fail"; code: string }>;
  action: { workflow: "rollback-rehearsal.yml" } | null;
  applyAuthorized: boolean;
};

type Check = RollbackRehearsalCoordinatorReport["checks"][number];

function error(code: string): Error {
  const result = new Error(code);
  result.name = code;
  return result;
}

function check(name: string, passed: boolean, code: string): Check {
  return { name, status: passed ? "pass" : "fail", code: passed ? "OK" : code };
}

function safeId(value: string | null): boolean {
  return value !== null && /^[A-Za-z0-9._-]{1,80}$/u.test(value);
}

function safeRepository(value: string): boolean {
  const parts = value.split("/");
  return parts.length === 2 && parts.every((part) => /^[A-Za-z0-9_.-]{1,100}$/u.test(part)
    && part !== "." && part !== "..");
}

function safeRun(run: RollbackRehearsalCoordinatorRun): boolean {
  return Number.isSafeInteger(run.databaseId) && run.databaseId > 0
    && ["Release candidate acceptance", "Release closeout", "Rollback rehearsal verification"].includes(run.workflowName)
    && run.displayTitle.length > 0 && run.displayTitle.length <= 256
    && /^[a-fA-F0-9]{40}$/u.test(run.headSha)
    && ["queued", "in_progress", "completed", "waiting", "pending", "requested"].includes(run.status)
    && (run.conclusion === null || /^[a-z_]{1,40}$/u.test(run.conclusion))
    && run.artifactNames.every((name) => /^[A-Za-z0-9_.-]{1,200}$/u.test(name));
}

export class RollbackRehearsalCoordinatorService {
  plan(input: RollbackRehearsalCoordinatorInput): RollbackRehearsalCoordinatorReport {
    if (!safeRepository(input.repository)) throw error("ROLLBACK_COORDINATOR_REPOSITORY_INVALID");
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$/u.test(input.actorLogin)) {
      throw error("ROLLBACK_COORDINATOR_ACTOR_INVALID");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/u.test(input.defaultBranch)
        || input.defaultBranch.includes("..") || input.defaultBranch.includes("//")) {
      throw error("ROLLBACK_COORDINATOR_BRANCH_INVALID");
    }
    if (!/^[a-fA-F0-9]{40}$/u.test(input.localCommitSha)
        || !/^[a-fA-F0-9]{40}$/u.test(input.remoteDefaultCommitSha)) {
      throw error("ROLLBACK_COORDINATOR_COMMIT_INVALID");
    }
    if (!Number.isSafeInteger(input.dirtyFileCount) || input.dirtyFileCount < 0) {
      throw error("ROLLBACK_COORDINATOR_DIRTY_COUNT_INVALID");
    }
    if (input.runs.some((run) => !safeRun(run))) throw error("ROLLBACK_COORDINATOR_RUN_INVALID");

    const candidateCommitSha = input.localCommitSha.toLowerCase();
    const currentIdValid = safeId(input.currentReleaseId);
    const targetIdValid = safeId(input.targetReleaseId);
    const drillIdValid = safeId(input.drillId);
    const currentRun = input.runs.find(({ databaseId }) => databaseId === input.currentAcceptanceRunId);
    const targetRun = input.runs.find(({ databaseId }) => databaseId === input.targetCloseoutRunId);
    const currentArtifact = currentIdValid && input.currentAcceptanceRunId
      ? `release-acceptance-${input.currentReleaseId}-${input.currentAcceptanceRunId}` : null;
    const targetArtifact = targetIdValid && input.targetCloseoutRunId
      ? `release-closeout-${input.targetReleaseId}-${input.targetCloseoutRunId}` : null;
    const currentValid = currentRun?.workflowName === "Release candidate acceptance"
      && currentRun.status === "completed" && currentRun.conclusion === "success"
      && currentRun.headSha.toLowerCase() === candidateCommitSha
      && currentArtifact !== null && currentRun.artifactNames.includes(currentArtifact);
    const targetValid = targetRun?.workflowName === "Release closeout"
      && targetRun.status === "completed" && targetRun.conclusion === "success"
      && targetArtifact !== null && targetRun.artifactNames.includes(targetArtifact);
    const expectedTitle = drillIdValid ? `Rollback rehearsal · ${input.drillId}` : null;
    const existing = expectedTitle === null ? [] : input.runs.filter((run) =>
      run.workflowName === "Rollback rehearsal verification"
      && run.displayTitle === expectedTitle
      && run.headSha.toLowerCase() === candidateCommitSha);
    const complete = existing.find((run) => run.status === "completed" && run.conclusion === "success");
    const active = existing.find((run) => run.status !== "completed");
    const secrets = new Set(input.repositorySecretNames);
    const checks: Check[] = [
      check("soloOperator", input.actorLogin.toLowerCase() === SOLO_RELEASE_OPERATOR_LOGIN.toLowerCase(),
        "ROLLBACK_COORDINATOR_SOLO_OPERATOR_MISMATCH"),
      check("candidatePublished", input.remoteDefaultCommitSha.toLowerCase() === candidateCommitSha,
        "ROLLBACK_COORDINATOR_CANDIDATE_NOT_PUBLISHED"),
      check("workingTree", input.dirtyFileCount === 0, "ROLLBACK_COORDINATOR_WORKING_TREE_NOT_CLEAN"),
      check("workflow", input.workflowActive, "ROLLBACK_COORDINATOR_WORKFLOW_NOT_ACTIVE"),
      check("input:drillId", drillIdValid, "ROLLBACK_COORDINATOR_DRILL_ID_INVALID"),
      check("input:currentReleaseId", currentIdValid, "ROLLBACK_COORDINATOR_CURRENT_RELEASE_ID_INVALID"),
      check("input:targetReleaseId", targetIdValid, "ROLLBACK_COORDINATOR_TARGET_RELEASE_ID_INVALID"),
      check("previousRelease", currentIdValid && targetIdValid && input.currentReleaseId !== input.targetReleaseId,
        "ROLLBACK_COORDINATOR_TARGET_NOT_PREVIOUS_RELEASE"),
      check("evidence:currentAcceptance", currentValid, "ROLLBACK_COORDINATOR_CURRENT_ACCEPTANCE_INVALID"),
      check("evidence:targetCloseout", targetValid, "ROLLBACK_COORDINATOR_TARGET_CLOSEOUT_INVALID"),
      ...ROLLBACK_REHEARSAL_SECRET_NAMES.map((name) => check(
        `secret:${name}`, secrets.has(name), "ROLLBACK_COORDINATOR_SECRET_MISSING",
      )),
      check("applyConfirmation", !input.applyRequested || input.confirmation === ROLLBACK_REHEARSAL_CONFIRMATION,
        "ROLLBACK_COORDINATOR_CONFIRMATION_REQUIRED"),
    ];
    const ok = checks.every(({ status }) => status === "pass");
    const stage = complete ? "complete" : active ? "in-progress" : ok ? "ready" : "blocked";
    const action = complete || active ? null : { workflow: "rollback-rehearsal.yml" as const };
    return {
      ok,
      mode: input.applyRequested ? "apply" : "dry-run",
      repository: input.repository,
      candidateCommitSha,
      drillId: drillIdValid ? input.drillId : null,
      stage,
      currentAcceptanceRunId: currentValid ? input.currentAcceptanceRunId : null,
      targetCloseoutRunId: targetValid ? input.targetCloseoutRunId : null,
      rehearsalRunId: complete?.databaseId ?? active?.databaseId ?? null,
      checks,
      action,
      applyAuthorized: input.applyRequested && ok && action !== null,
    };
  }
}
