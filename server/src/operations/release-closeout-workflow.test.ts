import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), "../.github/workflows/release-closeout.yml");

describe("release closeout workflow contract", () => {
  it("requires production approval, immutable identities, and least-privilege reads", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("packages: read");
    expect(workflow).toContain("^[a-f0-9]{40}$");
    expect(workflow).toContain("@sha256:[a-f0-9]{64}$");
    expect(workflow).not.toContain("pull_request_target");
  });

  it("downloads exact acceptance and deployment runs before checking both identities", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow.match(/actions\/download-artifact@v8/g)).toHaveLength(2);
    expect(workflow).toContain("release-acceptance-${{ inputs.release_id }}-${{ inputs.acceptance_run_id }}");
    expect(workflow).toContain("production-deployment-verification-${{ inputs.deployment_verification_run_id }}");
    expect(workflow).toContain(".releaseId == $releaseId");
    expect(workflow).toContain(".imageReference == $imageReference");
    expect(workflow).toContain(".expected.imageDigest == $imageDigest");
    expect(workflow).toContain('.name == "webDeployment" and .status == "pass"');
    expect(workflow).toContain(".web.expected.manifestSha256 == $webManifestSha256");
    expect(workflow).toContain("evidence/deployment/transport-security-evidence.json");
    expect(workflow).toContain("RELEASE_CLOSEOUT_TRANSPORT_SECURITY_REPORT");
    expect(workflow).toContain(".schemaVersion == 2");
    expect(workflow).toContain("evidence/deployment/mail-operations-evidence.json");
    expect(workflow).toContain("RELEASE_CLOSEOUT_MAIL_OPERATIONS_REPORT");
    expect(workflow).toContain('(has("providerEventId") | not)');
    expect(workflow).toContain("evidence/deployment/legal-approval-binding.json");
    expect(workflow).toContain("RELEASE_CLOSEOUT_LEGAL_APPROVAL_BINDING_REPORT");
  });

  it("runs closeout in the accepted image and uploads only the final input records", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const upload = workflow.indexOf("name: Upload final release closeout record");
    const uploadEnd = workflow.indexOf("name: End registry session");
    const uploadBlock = workflow.slice(upload, uploadEnd);

    expect(workflow).toContain('"$IMAGE_REFERENCE" node dist/release-closeout.js');
    expect(workflow).toContain("RELEASE_CLOSEOUT_MAX_DELAY_HOURS");
    expect(workflow).toContain("actions/upload-artifact@v7");
    expect(upload).toBeGreaterThan(0);
    expect(uploadEnd).toBeGreaterThan(upload);
    expect(uploadBlock).toContain("release-closeout.json");
    expect(uploadBlock).toContain("transport-security-evidence.json");
    expect(uploadBlock).toContain("mail-operations-evidence.json");
    expect(uploadBlock).toContain("legal-approval-binding.json");
    expect(uploadBlock).not.toMatch(/^\s+evidence\s*$/m);
  });
});
