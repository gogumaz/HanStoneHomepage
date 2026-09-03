import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), "../.github/workflows/production-deployment-verification.yml");

describe("production deployment verification workflow contract", () => {
  it("binds API and web deployment checks to immutable accepted identities", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("DEPLOY_VERIFY_EXPECTED_COMMIT_SHA: ${{ inputs.expected_commit_sha }}");
    expect(workflow).toContain("DEPLOY_VERIFY_RELEASE_ID: ${{ inputs.release_id }}");
    expect(workflow).toContain("DEPLOY_VERIFY_EXPECTED_IMAGE_DIGEST: ${{ inputs.expected_image_digest }}");
    expect(workflow).toContain("DEPLOY_VERIFY_EXPECTED_WEB_MANIFEST_SHA256: ${{ inputs.expected_web_manifest_sha256 }}");
    expect(workflow).toContain("DEPLOY_VERIFY_WEB_BASE_URL: ${{ secrets.PRODUCTION_WEB_BASE_URL }}");
    expect(workflow).toContain("acceptance_run_id:");
    expect(workflow).toContain("actions/download-artifact@v8");
    expect(workflow).toContain("PRODUCTION_PREFLIGHT_ENV_FILE_BASE64");
    expect(workflow).toContain("node dist/transport-security-evidence.js");
    expect(workflow).toContain("TRANSPORT_EVIDENCE_RELEASE_ID: ${{ inputs.release_id }}");
    expect(workflow).toContain("TRANSPORT_EVIDENCE_MIN_CERT_VALIDITY_DAYS: \"14\"");
    expect(workflow).toContain("server/transport-security-evidence.json");
    expect(workflow).toContain("node dist/mail-operations-evidence.js");
    expect(workflow).toContain("MAIL_EVIDENCE_RELEASE_ID: ${{ inputs.release_id }}");
    expect(workflow).toContain("PRODUCTION_MAIL_BOUNCE_RESPONSE_BASE64");
    expect(workflow).toContain("server/mail-operations-evidence.json");
    expect(workflow).toContain("PRODUCTION_LEGAL_APPROVAL_EVIDENCE_BASE64");
    expect(workflow).toContain("node dist/legal-approval-binding.js");
    expect(workflow).toContain("LEGAL_BINDING_RELEASE_ID: ${{ inputs.release_id }}");
    expect(workflow).toContain("server/legal-approval-binding.json");
    expect(workflow).toContain("evidence/transport/legal-policy-approval.json");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("actions/upload-artifact@v7");
    expect(workflow).not.toContain("pull_request_target");
  });
});
