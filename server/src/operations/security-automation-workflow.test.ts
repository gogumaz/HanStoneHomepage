import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const codeqlWorkflowPath = resolve(process.cwd(), "../.github/workflows/codeql.yml");
const dependabotConfigPath = resolve(process.cwd(), "../.github/dependabot.yml");
const repositoryRoot = resolve(process.cwd(), "..");

function readRepositoryText(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/gu, "\n");
}

describe("repository security automation", () => {
  it("runs least-privilege CodeQL analysis for JavaScript and TypeScript", () => {
    const workflow = readRepositoryText(codeqlWorkflowPath);

    expect(workflow).toContain("name: CodeQL security analysis");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("schedule:");
    expect(workflow).not.toContain("pull_request_target:");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("security-events: write");
    expect(workflow).toContain("github/codeql-action/init@v4");
    expect(workflow).toContain("github/codeql-action/analyze@v4");
    expect(workflow).toContain("languages: javascript-typescript");
    expect(workflow).toContain("queries: security-extended");
  });

  it("checks every package, container, and workflow dependency each week", () => {
    const config = readRepositoryText(dependabotConfigPath);

    expect(config).toContain("version: 2");
    expect(config.match(/package-ecosystem: npm/g)).toHaveLength(3);
    expect(config).toContain('directory: "/"');
    expect(config).toContain('directory: "/server"');
    expect(config).toContain('directory: "/server/src/components"');
    expect(config.match(/package-ecosystem: docker/g)).toHaveLength(2);
    expect(config).toContain('directory: "/deploy/clamav"');
    expect(config).toContain("package-ecosystem: github-actions");
    expect(config.match(/interval: weekly/g)).toHaveLength(6);
    expect(config.match(/timezone: Asia\/Seoul/g)).toHaveLength(6);
    expect(config).toContain("rebase-strategy: auto");
  });

  it("builds and verifies the managed ClamAV image in CI", () => {
    const workflow = readRepositoryText(resolve(process.cwd(), "../.github/workflows/ci.yml"));

    expect(workflow).toContain("clamav-container:");
    expect(workflow).toContain("docker build -t baduk-history-clamav:ci deploy/clamav");
    expect(workflow).toContain('grep -Eq "^StreamMaxLength 2200M$" /etc/clamav/clamd.conf');
    expect(workflow).toContain('grep -Eq "^MaxFileSize 2200M$" /etc/clamav/clamd.conf');
    expect(workflow).toContain('grep -Eq "^MaxScanSize 2200M$" /etc/clamav/clamd.conf');
  });

  it("publishes an attested immutable ClamAV image for anonymous production pulls", () => {
    const workflow = readRepositoryText(
      resolve(process.cwd(), "../.github/workflows/publish-clamav-image.yml"),
    );

    expect(workflow).toContain("name: Publish managed ClamAV image");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain('test "$PUBLISH_CONFIRMATION" = "PUBLISH_CLAMAV_IMAGE"');
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("packages: write");
    expect(workflow).toContain("attestations: write");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain("ghcr.io/gogumaz/hanstone-clamav");
    expect(workflow).toContain("platforms: linux/amd64");
    expect(workflow).toContain("push: true");
    expect(workflow).toContain("provenance: mode=max");
    expect(workflow).toContain("sbom: true");
    expect(workflow).toContain("subject-digest: ${{ steps.push.outputs.digest }}");
    expect(workflow).toContain('docker pull "$CLAMAV_IMAGE_REPOSITORY@$IMAGE_DIGEST"');
    expect(workflow).toContain("immutableReference");
    expect(workflow).toContain("retention-days: 90");
    expect(workflow).not.toMatch(/uses: [^\n]+@(v|main|master)(?:\d|\b)/u);
  });

  it("keeps CI, package engines, and the production image on Node.js 26", () => {
    const workflowPaths = [
      ".github/workflows/ci.yml",
      ".github/workflows/production-deployment-verification.yml",
      ".github/workflows/release-readiness.yml",
      ".github/workflows/rollback-rehearsal.yml",
      ".github/workflows/staging-read-only-load.yml",
      ".github/workflows/staging-worker-soak.yml",
    ];

    for (const workflowPath of workflowPaths) {
      const workflow = readRepositoryText(resolve(repositoryRoot, workflowPath));
      expect(workflow).not.toContain("node-version: 24");
      expect(workflow).toContain("node-version: 26");
    }

    const webPackage = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));
    const apiPackage = JSON.parse(readFileSync(resolve(repositoryRoot, "server/package.json"), "utf8"));
    const componentsPackage = JSON.parse(
      readFileSync(resolve(repositoryRoot, "server/src/components/package.json"), "utf8"),
    );
    const dockerfile = readFileSync(resolve(repositoryRoot, "server/Dockerfile"), "utf8");
    const nvmVersion = readRepositoryText(resolve(repositoryRoot, ".nvmrc")).trim();

    expect(webPackage.engines.node).toBe(">=26");
    expect(apiPackage.engines.node).toBe(">=26");
    expect(componentsPackage.engines.node).toBe(">=26");
    expect(dockerfile).toContain("FROM node:26-bookworm-slim AS base");
    expect(dockerfile).toContain("COPY --chmod=0644 package.json package-lock.json ./");
    expect(dockerfile).toContain("RUN chmod -R a+rX ./prisma ./scripts");
    expect(nvmVersion).toBe("26");
  });
});
