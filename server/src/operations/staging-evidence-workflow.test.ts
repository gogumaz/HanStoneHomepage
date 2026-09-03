import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflows = [
  resolve(process.cwd(), "../.github/workflows/staging-read-only-load.yml"),
  resolve(process.cwd(), "../.github/workflows/staging-worker-soak.yml"),
];

describe("staging evidence workflow coordination contract", () => {
  it.each(workflows)("provides a correlation input and keeps read-only permissions: %s", async (workflowPath) => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("evidence_id:");
    expect(workflow).toContain("${{ inputs.evidence_id }}");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).not.toContain("environment: production");
    expect(workflow).not.toContain("pull_request_target");
  });
});
