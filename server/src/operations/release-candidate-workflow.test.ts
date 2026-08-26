import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), "../.github/workflows/release-candidate-acceptance.yml");

describe("release candidate acceptance workflow contract", () => {
  it("uses protected immutable inputs and read-only repository permissions", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("packages: read");
    expect(workflow).toContain("^[a-f0-9]{40}$");
    expect(workflow).toContain("@sha256:[a-f0-9]{64}$");
    expect(workflow).not.toContain("pull_request_target");
  });

  it("downloads commit-bound evidence and evaluates all seven required reports", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("staging-read-only-load-report-${{ inputs.load_test_run_id }}");
    expect(workflow).toContain("staging-worker-soak-report-${{ inputs.worker_soak_run_id }}");
    expect(workflow).toContain("release-supply-chain-${{ inputs.candidate_commit_sha }}");
    expect(workflow).toContain("browser-field-validation-${{ inputs.supply_chain_run_id }}");
    expect(workflow).toContain("web-release-${{ inputs.candidate_commit_sha }}");
    expect(workflow.match(/actions\/download-artifact@v8/g)).toHaveLength(5);
    expect(workflow).toContain("actions/upload-artifact@v7");
    expect(workflow).toContain("RELEASE_PREFLIGHT_REPORT=/evidence/production-preflight.json");
    expect(workflow).toContain("RELEASE_RECOVERY_REPORT=/evidence/recovery-drill.json");
    expect(workflow).toContain("RELEASE_LOAD_REPORT=/evidence/read-only-load/staging-read-only-load-report.json");
    expect(workflow).toContain("RELEASE_WORKER_SOAK_REPORT=/evidence/worker-soak/staging-worker-soak-report.json");
    expect(workflow).toContain("RELEASE_WEB_DEPLOYMENT_REPORT=/evidence/web-deployment/web-deployment-manifest.json");
    expect(workflow).toContain("RELEASE_FIELD_VALIDATION_REPORT=/evidence/field-validation/field-validation-report.json");
    expect(workflow).toContain("RELEASE_SUPPLY_CHAIN_REPORT=/evidence/supply-chain/manifest.json");
  });

  it("removes the decoded production environment before uploading an explicit allowlist", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const removal = workflow.indexOf('rm -f -- "$GITHUB_WORKSPACE/evidence/preflight.env"');
    const upload = workflow.indexOf("name: Upload release acceptance record");
    const uploadEnd = workflow.indexOf("name: End registry session");
    const uploadBlock = workflow.slice(upload, uploadEnd);

    expect(workflow).toContain("PREFLIGHT_REQUIRE_CDN=true");
    expect(removal).toBeGreaterThan(0);
    expect(upload).toBeGreaterThan(removal);
    expect(uploadEnd).toBeGreaterThan(upload);
    expect(uploadBlock).not.toMatch(/^\s+evidence\s*$/m);
    expect(uploadBlock).not.toContain("evidence/preflight.env");
  });
});
