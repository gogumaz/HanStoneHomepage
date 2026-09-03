import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), "../.github/workflows/rollback-rehearsal.yml");

describe("rollback rehearsal workflow contract", () => {
  it("uses immutable prior evidence and never enters the production environment", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    expect(workflow).toContain("AUTHORIZE_ISOLATED_ROLLBACK_REHEARSAL");
    expect(workflow).toContain("actions/download-artifact@v8");
    expect(workflow).toContain("release-acceptance-${{ inputs.current_release_id }}-${{ inputs.current_acceptance_run_id }}");
    expect(workflow).toContain("release-closeout-${{ inputs.target_release_id }}-${{ inputs.target_closeout_run_id }}");
    expect(workflow).toContain('DEPLOY_VERIFY_REQUIRE_NON_PRODUCTION: "true"');
    expect(workflow).toContain("DEPLOY_VERIFY_RELEASE_ID: ${{ inputs.target_release_id }}");
    expect(workflow).not.toContain("environment: production");
    expect(workflow).not.toContain("pull_request_target");
  });

  it("re-verifies both API and web and retains the sealed evidence for 90 days", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const verify = workflow.indexOf("name: Re-verify restored API and web release");
    const seal = workflow.indexOf("name: Seal rollback rehearsal evidence");
    const upload = workflow.indexOf("name: Upload rollback rehearsal evidence");
    expect(verify).toBeGreaterThan(0);
    expect(seal).toBeGreaterThan(verify);
    expect(upload).toBeGreaterThan(seal);
    expect(workflow).toContain("rollback-rehearsal-evidence.json");
    expect(workflow).toContain("retention-days: 90");
  });
});
