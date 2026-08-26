export const FIELD_VALIDATION_PROJECTS = [
  "chromium",
  "field-firefox",
  "field-mobile-chrome",
  "field-mobile-safari",
] as const;

export type FieldValidationRecord = {
  projectName: string;
  status: "passed" | "failed" | "skipped" | "flaky";
};

export type FieldValidationReport = {
  schemaVersion: 1;
  ok: boolean;
  commitSha: string | null;
  completedAt: string;
  projects: Array<{
    name: string;
    status: "pass" | "fail";
    passed: number;
    failed: number;
    skipped: number;
    flaky: number;
  }>;
  totals: {
    passed: number;
    failed: number;
    skipped: number;
    flaky: number;
  };
};

export function createFieldValidationReport(input: {
  commitSha: string | undefined;
  completedAt: Date;
  records: FieldValidationRecord[];
}): FieldValidationReport {
  const commitSha = input.commitSha?.trim().toLowerCase() ?? "";
  const normalizedCommitSha = /^[a-f0-9]{40}$/.test(commitSha) ? commitSha : null;
  const projects = FIELD_VALIDATION_PROJECTS.map((name) => {
    const records = input.records.filter((record) => record.projectName === name);
    const passed = records.filter(({ status }) => status === "passed").length;
    const failed = records.filter(({ status }) => status === "failed").length;
    const skipped = records.filter(({ status }) => status === "skipped").length;
    const flaky = records.filter(({ status }) => status === "flaky").length;
    return {
      name,
      status: passed > 0 && failed === 0 && flaky === 0 ? "pass" as const : "fail" as const,
      passed,
      failed,
      skipped,
      flaky,
    };
  });
  const totals = projects.reduce((sum, project) => ({
    passed: sum.passed + project.passed,
    failed: sum.failed + project.failed,
    skipped: sum.skipped + project.skipped,
    flaky: sum.flaky + project.flaky,
  }), { passed: 0, failed: 0, skipped: 0, flaky: 0 });

  return {
    schemaVersion: 1,
    ok: normalizedCommitSha !== null && projects.every(({ status }) => status === "pass"),
    commitSha: normalizedCommitSha,
    completedAt: input.completedAt.toISOString(),
    projects,
    totals,
  };
}
