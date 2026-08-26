import "dotenv/config";
import {
  ReleaseAcceptanceService,
} from "./operations/release-acceptance.service.js";
import { readReleaseEvidenceFile } from "./operations/release-evidence-file.js";

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

function hours(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw cliError(`${name}_INVALID`);
  return value;
}

async function main(): Promise<void> {
  const evidenceFiles = {
    preflight: await readReleaseEvidenceFile("preflight", required("RELEASE_PREFLIGHT_REPORT")),
    recovery: await readReleaseEvidenceFile("recovery", required("RELEASE_RECOVERY_REPORT")),
    readOnlyLoad: await readReleaseEvidenceFile("readOnlyLoad", required("RELEASE_LOAD_REPORT")),
    workerSoak: await readReleaseEvidenceFile("workerSoak", required("RELEASE_WORKER_SOAK_REPORT")),
    webDeployment: await readReleaseEvidenceFile("webDeployment", required("RELEASE_WEB_DEPLOYMENT_REPORT")),
    fieldValidation: await readReleaseEvidenceFile("fieldValidation", required("RELEASE_FIELD_VALIDATION_REPORT")),
    supplyChain: await readReleaseEvidenceFile("supplyChain", required("RELEASE_SUPPLY_CHAIN_REPORT")),
  };
  const result = new ReleaseAcceptanceService().run({
    releaseId: required("RELEASE_ID"),
    commitSha: required("RELEASE_COMMIT_SHA"),
    imageReference: required("RELEASE_IMAGE_REFERENCE"),
    reports: {
      preflight: evidenceFiles.preflight.value,
      recovery: evidenceFiles.recovery.value,
      readOnlyLoad: evidenceFiles.readOnlyLoad.value,
      workerSoak: evidenceFiles.workerSoak.value,
      webDeployment: evidenceFiles.webDeployment.value,
      fieldValidation: evidenceFiles.fieldValidation.value,
      supplyChain: evidenceFiles.supplyChain.value,
    },
    evidenceSha256: {
      preflight: evidenceFiles.preflight.sha256,
      recovery: evidenceFiles.recovery.sha256,
      readOnlyLoad: evidenceFiles.readOnlyLoad.sha256,
      workerSoak: evidenceFiles.workerSoak.sha256,
      webDeployment: evidenceFiles.webDeployment.sha256,
      fieldValidation: evidenceFiles.fieldValidation.sha256,
      supplyChain: evidenceFiles.supplyChain.sha256,
    },
    maximumAgeHours: {
      preflight: hours("RELEASE_PREFLIGHT_MAX_AGE_HOURS", 24),
      recovery: hours("RELEASE_RECOVERY_MAX_AGE_HOURS", 2_400),
      readOnlyLoad: hours("RELEASE_LOAD_MAX_AGE_HOURS", 168),
      workerSoak: hours("RELEASE_WORKER_SOAK_MAX_AGE_HOURS", 168),
      webDeployment: hours("RELEASE_WEB_DEPLOYMENT_MAX_AGE_HOURS", 168),
      fieldValidation: hours("RELEASE_FIELD_VALIDATION_MAX_AGE_HOURS", 168),
      supplyChain: hours("RELEASE_SUPPLY_CHAIN_MAX_AGE_HOURS", 168),
    },
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const name = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(error.name) ? error.name : "UNKNOWN";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType: name })}\n`);
  process.exitCode = 1;
});
