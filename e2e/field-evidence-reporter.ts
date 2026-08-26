import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import {
  createFieldValidationReport,
  type FieldValidationRecord,
} from "../src/operations/field-validation-evidence";

type ReporterOptions = { outputFile?: string };

export default class FieldEvidenceReporter implements Reporter {
  private readonly outputFile: string;
  private readonly records = new Map<string, FieldValidationRecord>();

  constructor(options: ReporterOptions = {}) {
    this.outputFile = resolve(options.outputFile ?? "test-results/field-validation-report.json");
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!test.location.file.replaceAll("\\", "/").endsWith("/field-validation.spec.ts")) return;
    const projectName = test.parent.project()?.name ?? "unknown";
    const status = result.status === "passed"
      ? result.retry > 0 ? "flaky" : "passed"
      : result.status === "skipped" ? "skipped" : "failed";
    this.records.set(`${projectName}:${test.id}`, { projectName, status });
  }

  onEnd(): void {
    const report = createFieldValidationReport({
      commitSha: process.env.EVIDENCE_COMMIT_SHA ?? process.env.GITHUB_SHA,
      completedAt: new Date(),
      records: [...this.records.values()],
    });
    mkdirSync(dirname(this.outputFile), { recursive: true });
    writeFileSync(this.outputFile, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}
