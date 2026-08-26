import { describe, expect, it, vi } from "vitest";
import {
  REQUIRED_RECOVERY_MIGRATION,
  REQUIRED_RECOVERY_TABLES,
  RecoveryDrillDatabase,
  RecoveryDrillService,
  validateRecoveryTarget,
} from "./recovery-drill.service.js";
import { REQUIRED_PRODUCTION_MIGRATION } from "./production-preflight.service.js";

type DrillFixture = {
  migrationApplied?: boolean;
  missingTable?: string;
  relationshipsValid?: boolean;
};

function databaseFixture(fixture: DrillFixture = {}): RecoveryDrillDatabase {
  const query = vi.fn(async (text: string): Promise<{ rows: unknown[] }> => {
    if (text.includes("_prisma_migrations")) {
      return { rows: [{ applied: fixture.migrationApplied ?? true }] };
    }
    if (text.includes("information_schema")) {
      return {
        rows: REQUIRED_RECOVERY_TABLES
          .filter((tableName) => tableName !== fixture.missingTable)
          .map((tableName) => ({ tableName })),
      };
    }
    if (text.includes("accountMailJobsValid")) {
      const valid = fixture.relationshipsValid ?? true;
      return {
        rows: [{
          accountMailJobsValid: valid,
          subscriptionsValid: valid,
          missionAttemptsValid: valid,
          inquiryNotificationsValid: valid,
        }],
      };
    }
    throw new Error("UNEXPECTED_QUERY");
  });
  return {
    query: query as RecoveryDrillDatabase["query"],
  };
}

function input(overrides: Partial<Parameters<RecoveryDrillService["run"]>[0]> = {}) {
  return {
    drillId: "quarterly-2026-q3",
    backupCreatedAt: "2026-08-24T03:00:00.000Z",
    restoreStartedAt: "2026-08-24T03:10:00.000Z",
    targetRpoMinutes: 15,
    targetRtoMinutes: 240,
    ...overrides,
  };
}

describe("validateRecoveryTarget", () => {
  const production = "postgresql://prod-user:secret@database.example.com:5432/baduk";

  it("rejects the production database even when credentials differ", () => {
    expect(() => validateRecoveryTarget(
      "postgresql://readonly:different@database.example.com:5432/baduk",
      production,
    )).toThrowError(expect.objectContaining({ name: "RECOVERY_TARGET_MATCHES_PRODUCTION" }));
  });

  it("rejects a target whose host or database is marked as production", () => {
    expect(() => validateRecoveryTarget(
      "postgresql://readonly:secret@prod-db.example.com:5432/baduk_recovery",
      production,
    )).toThrowError(expect.objectContaining({ name: "RECOVERY_TARGET_LOOKS_LIKE_PRODUCTION" }));
  });

  it("accepts an explicitly isolated recovery database", () => {
    expect(() => validateRecoveryTarget(
      "postgresql://readonly:secret@staging-db.example.com:5432/baduk_recovery",
      production,
    )).not.toThrow();
  });
});

describe("RecoveryDrillService", () => {
  it("uses the same required migration as the production deployment gate", () => {
    expect(REQUIRED_RECOVERY_MIGRATION).toBe(REQUIRED_PRODUCTION_MIGRATION);
  });

  it("passes schema, relationship, RPO, and RTO checks without exposing connection secrets", async () => {
    const times = [
      new Date("2026-08-24T03:11:00.000Z"),
      new Date("2026-08-24T03:12:00.000Z"),
    ];
    const report = await new RecoveryDrillService(databaseFixture(), () => times.shift()!).run(input());

    expect(report.ok).toBe(true);
    expect(report.objectives).toMatchObject({ rpoMinutes: 10, rtoMinutes: 2, rpoMet: true, rtoMet: true });
    expect(report.checks).toHaveLength(5);
    expect(report.checks[0]).toMatchObject({
      name: "migration",
      status: "pass",
      detail: `migration=${REQUIRED_RECOVERY_MIGRATION}`,
    });
    expect(JSON.stringify(report)).not.toContain("secret");
    expect(JSON.stringify(report)).not.toContain("postgresql://");
  });

  it("fails when the latest migration or a critical table is missing", async () => {
    const clock = () => new Date("2026-08-24T03:12:00.000Z");
    const report = await new RecoveryDrillService(databaseFixture({
      migrationApplied: false,
      missingTable: "AccountMailJob",
    }), clock).run(input());

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({ name: "migration", status: "fail" }));
    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "criticalTables",
      status: "fail",
      detail: "missing=AccountMailJob",
    }));
  });

  it("fails relationship integrity and missed recovery objectives", async () => {
    const clock = () => new Date("2026-08-24T08:00:00.000Z");
    const report = await new RecoveryDrillService(databaseFixture({ relationshipsValid: false }), clock).run(input({
      backupCreatedAt: "2026-08-24T02:00:00.000Z",
    }));

    expect(report.ok).toBe(false);
    expect(report.objectives).toMatchObject({ rpoMet: false, rtoMet: false });
    expect(report.checks).toContainEqual(expect.objectContaining({ name: "relationships", status: "fail" }));
    expect(report.checks).toContainEqual(expect.objectContaining({ name: "rpo", status: "fail" }));
    expect(report.checks).toContainEqual(expect.objectContaining({ name: "rto", status: "fail" }));
  });

  it("rejects an impossible recovery timeline before querying the database", async () => {
    const database = databaseFixture();
    const service = new RecoveryDrillService(database, () => new Date("2026-08-24T03:00:00.000Z"));

    await expect(service.run(input({
      backupCreatedAt: "2026-08-24T03:20:00.000Z",
    }))).rejects.toMatchObject({ name: "RECOVERY_TIMELINE_INVALID" });
    expect(database.query).not.toHaveBeenCalled();
  });
});
