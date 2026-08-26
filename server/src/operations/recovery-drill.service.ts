export const REQUIRED_RECOVERY_MIGRATION = "20260824002300_account_mail_outbox";

export const REQUIRED_RECOVERY_TABLES = [
  "User",
  "AccountToken",
  "AccountMailJob",
  "SubscriptionOrder",
  "AccountSubscription",
  "StoreOrder",
  "Lesson",
  "BadukMission",
  "MissionAttempt",
  "Inquiry",
  "InquiryNotificationJob",
  "ObjectDeletionJob",
] as const;

type QueryResult<Row> = {
  rows: Row[];
};

export type RecoveryDrillDatabase = {
  query<Row>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
};

export type RecoveryDrillInput = {
  drillId: string;
  backupCreatedAt: string;
  restoreStartedAt: string;
  targetRpoMinutes: number;
  targetRtoMinutes: number;
};

export type RecoveryDrillCheck = {
  name: "migration" | "criticalTables" | "relationships" | "rpo" | "rto";
  status: "pass" | "fail";
  detail: string;
};

export type RecoveryDrillReport = {
  ok: boolean;
  drillId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  objectives: {
    rpoMinutes: number;
    rtoMinutes: number;
    targetRpoMinutes: number;
    targetRtoMinutes: number;
    rpoMet: boolean;
    rtoMet: boolean;
  };
  checks: RecoveryDrillCheck[];
};

function configurationError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function parseTimestamp(value: string, code: string): Date {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw configurationError(code);
  return new Date(milliseconds);
}

function requirePositiveNumber(value: number, code: string): number {
  if (!Number.isFinite(value) || value <= 0) throw configurationError(code);
  return value;
}

function databaseIdentity(url: URL): string {
  const port = url.port || "5432";
  return `${url.hostname.toLowerCase()}:${port}/${decodeURIComponent(url.pathname).replace(/^\//, "").toLowerCase()}`;
}

function parsePostgresUrl(value: string, code: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw configurationError(code);
  }
  if (!(["postgres:", "postgresql:"] as string[]).includes(url.protocol) || !url.hostname || url.pathname === "/") {
    throw configurationError(code);
  }
  return url;
}

export function validateRecoveryTarget(recoveryDatabaseUrl: string, productionDatabaseUrl: string): void {
  const recovery = parsePostgresUrl(recoveryDatabaseUrl, "RECOVERY_DATABASE_URL_INVALID");
  const production = parsePostgresUrl(productionDatabaseUrl, "DATABASE_URL_INVALID");

  if (databaseIdentity(recovery) === databaseIdentity(production)) {
    throw configurationError("RECOVERY_TARGET_MATCHES_PRODUCTION");
  }

  const hostname = recovery.hostname.toLowerCase();
  const databaseName = decodeURIComponent(recovery.pathname).replace(/^\//, "").toLowerCase();
  const targetLabel = `${hostname}/${databaseName}`;
  if (/(^|[._-])(prod|production)([._-]|$)/i.test(targetLabel)) {
    throw configurationError("RECOVERY_TARGET_LOOKS_LIKE_PRODUCTION");
  }
  if (!/(^|[._-])(recovery|restore|restored|staging|stage|drill|test|sandbox)([._-]|$)/i.test(targetLabel)) {
    throw configurationError("RECOVERY_TARGET_NOT_ISOLATED");
  }
}

function failedQueryDetail(error: unknown): string {
  return `query=failed:${error instanceof Error ? error.name : "UNKNOWN"}`;
}

export class RecoveryDrillService {
  constructor(
    private readonly database: RecoveryDrillDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async run(input: RecoveryDrillInput): Promise<RecoveryDrillReport> {
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(input.drillId)) {
      throw configurationError("RECOVERY_DRILL_ID_INVALID");
    }
    const backupCreatedAt = parseTimestamp(input.backupCreatedAt, "RECOVERY_BACKUP_CREATED_AT_INVALID");
    const restoreStartedAt = parseTimestamp(input.restoreStartedAt, "RECOVERY_RESTORE_STARTED_AT_INVALID");
    const targetRpoMinutes = requirePositiveNumber(input.targetRpoMinutes, "RECOVERY_RPO_MINUTES_INVALID");
    const targetRtoMinutes = requirePositiveNumber(input.targetRtoMinutes, "RECOVERY_RTO_MINUTES_INVALID");
    const startedAt = this.now();

    if (backupCreatedAt.getTime() > restoreStartedAt.getTime()) {
      throw configurationError("RECOVERY_TIMELINE_INVALID");
    }
    if (restoreStartedAt.getTime() > startedAt.getTime()) {
      throw configurationError("RECOVERY_RESTORE_STARTED_AT_IN_FUTURE");
    }

    const checks: RecoveryDrillCheck[] = [];

    try {
      const migrationResult = await this.database.query<{ applied: boolean }>(
        `SELECT EXISTS (
           SELECT 1
             FROM "_prisma_migrations"
            WHERE "migration_name" = $1
              AND "finished_at" IS NOT NULL
              AND "rolled_back_at" IS NULL
         ) AS "applied"`,
        [REQUIRED_RECOVERY_MIGRATION],
      );
      const applied = migrationResult.rows[0]?.applied === true;
      checks.push({
        name: "migration",
        status: applied ? "pass" : "fail",
        detail: applied ? `migration=${REQUIRED_RECOVERY_MIGRATION}` : "requiredMigration=missing",
      });
    } catch (error) {
      checks.push({ name: "migration", status: "fail", detail: failedQueryDetail(error) });
    }

    try {
      const tableResult = await this.database.query<{ tableName: string }>(
        `SELECT "table_name" AS "tableName"
           FROM "information_schema"."tables"
          WHERE "table_schema" = 'public'
            AND "table_name" = ANY($1::text[])`,
        [[...REQUIRED_RECOVERY_TABLES]],
      );
      const found = new Set(tableResult.rows.map((row) => row.tableName));
      const missing = REQUIRED_RECOVERY_TABLES.filter((table) => !found.has(table));
      checks.push({
        name: "criticalTables",
        status: missing.length === 0 ? "pass" : "fail",
        detail: missing.length === 0 ? `required=${REQUIRED_RECOVERY_TABLES.length}` : `missing=${missing.join(",")}`,
      });
    } catch (error) {
      checks.push({ name: "criticalTables", status: "fail", detail: failedQueryDetail(error) });
    }

    try {
      const relationshipResult = await this.database.query<{
        accountMailJobsValid: boolean;
        subscriptionsValid: boolean;
        missionAttemptsValid: boolean;
        inquiryNotificationsValid: boolean;
      }>(
        `SELECT
           NOT EXISTS (
             SELECT 1 FROM "AccountMailJob" job
             LEFT JOIN "AccountToken" token ON token."id" = job."tokenId"
             WHERE token."id" IS NULL
           ) AS "accountMailJobsValid",
           NOT EXISTS (
             SELECT 1 FROM "AccountSubscription" subscription
             LEFT JOIN "SubscriptionOrder" payment_order ON payment_order."id" = subscription."orderId"
             WHERE payment_order."id" IS NULL
           ) AS "subscriptionsValid",
           NOT EXISTS (
             SELECT 1 FROM "MissionAttempt" attempt
             LEFT JOIN "BadukMission" mission ON mission."id" = attempt."missionId"
             WHERE mission."id" IS NULL
           ) AS "missionAttemptsValid",
           NOT EXISTS (
             SELECT 1 FROM "InquiryNotificationJob" job
             LEFT JOIN "Inquiry" inquiry ON inquiry."id" = job."inquiryId"
             WHERE inquiry."id" IS NULL
           ) AS "inquiryNotificationsValid"`,
      );
      const relationships = relationshipResult.rows[0];
      const invalid = [
        ["accountMailJobs", relationships?.accountMailJobsValid],
        ["subscriptions", relationships?.subscriptionsValid],
        ["missionAttempts", relationships?.missionAttemptsValid],
        ["inquiryNotifications", relationships?.inquiryNotificationsValid],
      ].filter(([, valid]) => valid !== true).map(([name]) => name);
      checks.push({
        name: "relationships",
        status: invalid.length === 0 ? "pass" : "fail",
        detail: invalid.length === 0 ? "criticalRelationships=valid" : `invalid=${invalid.join(",")}`,
      });
    } catch (error) {
      checks.push({ name: "relationships", status: "fail", detail: failedQueryDetail(error) });
    }

    const completedAt = this.now();
    const rpoMinutes = Math.max(0, (restoreStartedAt.getTime() - backupCreatedAt.getTime()) / 60_000);
    const rtoMinutes = Math.max(0, (completedAt.getTime() - restoreStartedAt.getTime()) / 60_000);
    const rpoMet = rpoMinutes <= targetRpoMinutes;
    const rtoMet = rtoMinutes <= targetRtoMinutes;
    checks.push({ name: "rpo", status: rpoMet ? "pass" : "fail", detail: `actualMinutes=${rpoMinutes};targetMinutes=${targetRpoMinutes}` });
    checks.push({ name: "rto", status: rtoMet ? "pass" : "fail", detail: `actualMinutes=${rtoMinutes};targetMinutes=${targetRtoMinutes}` });

    return {
      ok: checks.every((check) => check.status === "pass"),
      drillId: input.drillId,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
      objectives: {
        rpoMinutes,
        rtoMinutes,
        targetRpoMinutes,
        targetRtoMinutes,
        rpoMet,
        rtoMet,
      },
      checks,
    };
  }
}
