import { describe, expect, it } from "vitest";
import {
  createFieldValidationReport,
  FIELD_VALIDATION_PROJECTS,
  type FieldValidationRecord,
} from "./field-validation-evidence";

function passingRecords(): FieldValidationRecord[] {
  return FIELD_VALIDATION_PROJECTS.flatMap((projectName) => [
    { projectName, status: "passed" as const },
    { projectName, status: "skipped" as const },
  ]);
}

describe("createFieldValidationReport", () => {
  it("creates commit-bound evidence for every required browser profile", () => {
    const report = createFieldValidationReport({
      commitSha: "A".repeat(40),
      completedAt: new Date("2026-08-25T09:00:00.000Z"),
      records: passingRecords(),
    });

    expect(report.ok).toBe(true);
    expect(report.commitSha).toBe("a".repeat(40));
    expect(report.projects.map(({ name }) => name)).toEqual(FIELD_VALIDATION_PROJECTS);
    expect(report.projects.every(({ status }) => status === "pass")).toBe(true);
    expect(report.totals).toEqual({ passed: 4, failed: 0, skipped: 4, flaky: 0 });
  });

  it("fails closed for a missing profile, failure, retry success, or invalid commit", () => {
    const missing = passingRecords().filter(({ projectName }) => projectName !== "field-mobile-safari");
    const failed = passingRecords();
    failed.push({ projectName: "field-mobile-chrome", status: "failed" });
    const flaky = passingRecords();
    flaky.push({ projectName: "field-firefox", status: "flaky" });

    expect(createFieldValidationReport({
      commitSha: "a".repeat(40), completedAt: new Date(), records: missing,
    }).ok).toBe(false);
    expect(createFieldValidationReport({
      commitSha: "a".repeat(40), completedAt: new Date(), records: failed,
    }).ok).toBe(false);
    expect(createFieldValidationReport({
      commitSha: "a".repeat(40), completedAt: new Date(), records: flaky,
    }).ok).toBe(false);
    expect(createFieldValidationReport({
      commitSha: "main", completedAt: new Date(), records: passingRecords(),
    }).ok).toBe(false);
  });

  it("does not copy test titles, paths, errors, or attachments into the report", () => {
    const report = createFieldValidationReport({
      commitSha: "b".repeat(40),
      completedAt: new Date(),
      records: passingRecords().map((record) => ({ ...record, secretDetail: "private" })),
    });

    expect(JSON.stringify(report)).not.toContain("private");
  });
});
