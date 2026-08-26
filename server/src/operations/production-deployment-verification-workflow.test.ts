import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), "../.github/workflows/production-deployment-verification.yml");

describe("production deployment verification workflow contract", () => {
  it("binds API and web deployment checks to immutable accepted identities", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("DEPLOY_VERIFY_EXPECTED_COMMIT_SHA: ${{ inputs.expected_commit_sha }}");
    expect(workflow).toContain("DEPLOY_VERIFY_EXPECTED_IMAGE_DIGEST: ${{ inputs.expected_image_digest }}");
    expect(workflow).toContain("DEPLOY_VERIFY_EXPECTED_WEB_MANIFEST_SHA256: ${{ inputs.expected_web_manifest_sha256 }}");
    expect(workflow).toContain("DEPLOY_VERIFY_WEB_BASE_URL: ${{ secrets.PRODUCTION_WEB_BASE_URL }}");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("actions/upload-artifact@v7");
    expect(workflow).not.toContain("pull_request_target");
  });
});
