import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), "../.github/workflows/release-readiness.yml");

describe("release readiness workflow contract", () => {
  it("is manually triggered with read-only GitHub permissions", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("deployments: read");
    expect(workflow).toContain("GH_TOKEN: ${{ secrets.RELEASE_READINESS_TOKEN }}");
    expect(workflow).not.toContain("GH_TOKEN: ${{ github.token }}");
    expect(workflow).not.toContain("pull_request_target");
    expect(workflow).not.toContain("environment: production");
  });

  it("retains a sanitized report before enforcing the audit decision", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const audit = workflow.indexOf("name: Audit candidate and GitHub release prerequisites");
    const upload = workflow.indexOf("name: Upload release readiness evidence");
    const enforce = workflow.indexOf("name: Enforce release readiness decision");

    expect(workflow).toContain("continue-on-error: true");
    expect(workflow).toContain("npm run audit:release-readiness > release-readiness.json 2>&1");
    expect(workflow).toContain("actions/upload-artifact@v7");
    expect(workflow).toContain("path: server/release-readiness.json");
    expect(workflow).toContain("if-no-files-found: error");
    expect(audit).toBeGreaterThan(0);
    expect(upload).toBeGreaterThan(audit);
    expect(enforce).toBeGreaterThan(upload);
  });
});
