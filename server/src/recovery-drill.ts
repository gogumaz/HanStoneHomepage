import "dotenv/config";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  RecoveryDrillService,
  validateRecoveryTarget,
} from "./operations/recovery-drill.service.js";
import { withEvidenceCommitSha } from "./operations/evidence-metadata.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    const error = new Error(`${name}_REQUIRED`);
    error.name = `${name}_REQUIRED`;
    throw error;
  }
  return value;
}

function positiveNumberEnvironment(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    const error = new Error(`${name}_INVALID`);
    error.name = `${name}_INVALID`;
    throw error;
  }
  return value;
}

async function bootstrap(): Promise<void> {
  const recoveryDatabaseUrl = requiredEnvironment("RECOVERY_DATABASE_URL");
  validateRecoveryTarget(recoveryDatabaseUrl, requiredEnvironment("DATABASE_URL"));

  const client = new pg.Client({
    connectionString: recoveryDatabaseUrl,
    application_name: "baduk-recovery-drill",
    statement_timeout: 30_000,
  });
  let transactionStarted = false;
  try {
    await client.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    transactionStarted = true;
    const report = await new RecoveryDrillService(client).run({
      drillId: process.env.RECOVERY_DRILL_ID?.trim() || randomUUID(),
      backupCreatedAt: requiredEnvironment("RECOVERY_BACKUP_CREATED_AT"),
      restoreStartedAt: requiredEnvironment("RECOVERY_RESTORE_STARTED_AT"),
      targetRpoMinutes: positiveNumberEnvironment("RECOVERY_RPO_MINUTES", 15),
      targetRtoMinutes: positiveNumberEnvironment("RECOVERY_RTO_MINUTES", 240),
    });
    process.stdout.write(`${JSON.stringify(withEvidenceCommitSha(report), null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } finally {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    await client.end().catch(() => undefined);
  }
}

void bootstrap().catch((error: unknown) => {
  const detail = error instanceof Error ? error.name : "RECOVERY_DRILL_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, detail })}\n`);
  process.exitCode = 1;
});
