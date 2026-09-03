import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("release finalization workflow correlation contract", () => {
  it("binds production verification to a release ID", async () => {
    const workflow = await readFile(
      resolve(process.cwd(), "../.github/workflows/production-deployment-verification.yml"),
      "utf8",
    );
    expect(workflow).toContain("run-name: Production deployment verification · ${{ inputs.release_id }}");
    expect(workflow).toContain("release_id:");
    expect(workflow).toContain('[[ "${{ inputs.release_id }}" =~ ^[A-Za-z0-9._-]{1,80}$ ]]');
    expect(workflow).toContain("retention-days: 90");
  });

  it("binds final closeout to the same release ID", async () => {
    const workflow = await readFile(
      resolve(process.cwd(), "../.github/workflows/release-closeout.yml"),
      "utf8",
    );
    expect(workflow).toContain("run-name: Release closeout · ${{ inputs.release_id }}");
    expect(workflow).toContain("release_id:");
    expect(workflow).toContain("retention-days: 90");
  });
});
