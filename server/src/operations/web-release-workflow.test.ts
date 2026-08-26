import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), "../.github/workflows/ci.yml");

describe("web release workflow contract", () => {
  it("creates and verifies a commit-bound CDN manifest before upload", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const manifest = workflow.indexOf("name: Create commit-bound web CDN deployment manifest");
    const verify = workflow.indexOf("run: npm run verify:web-artifacts");
    const upload = workflow.indexOf("name: Upload immutable web release package");

    expect(workflow).toContain("WEB_RELEASE_COMMIT_SHA: ${{ github.sha }}");
    expect(workflow).toContain("run: npm run manifest:web-deployment");
    expect(manifest).toBeGreaterThan(0);
    expect(verify).toBeGreaterThan(manifest);
    expect(upload).toBeGreaterThan(verify);
  });

  it("retains the exact dist package under the candidate commit identity", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const upload = workflow.indexOf("name: Upload immutable web release package");
    const browserJob = workflow.indexOf("browser:");
    const uploadBlock = workflow.slice(upload, browserJob);

    expect(uploadBlock).toContain("actions/upload-artifact@v7");
    expect(uploadBlock).toContain("name: web-release-${{ github.sha }}");
    expect(uploadBlock).toContain("path: dist");
    expect(uploadBlock).toContain("if-no-files-found: error");
    expect(uploadBlock).toContain("retention-days: 90");
  });
});
