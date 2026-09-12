import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const codeqlWorkflowPath = resolve(process.cwd(), "../.github/workflows/codeql.yml");
const dependabotConfigPath = resolve(process.cwd(), "../.github/dependabot.yml");

describe("repository security automation", () => {
  it("runs least-privilege CodeQL analysis for JavaScript and TypeScript", () => {
    const workflow = readFileSync(codeqlWorkflowPath, "utf8");

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
    const config = readFileSync(dependabotConfigPath, "utf8");

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
    const workflow = readFileSync(resolve(process.cwd(), "../.github/workflows/ci.yml"), "utf8");

    expect(workflow).toContain("clamav-container:");
    expect(workflow).toContain("docker build -t baduk-history-clamav:ci deploy/clamav");
    expect(workflow).toContain('grep -Eq "^StreamMaxLength 2200M$" /etc/clamav/clamd.conf');
    expect(workflow).toContain('grep -Eq "^MaxFileSize 2200M$" /etc/clamav/clamd.conf');
    expect(workflow).toContain('grep -Eq "^MaxScanSize 2200M$" /etc/clamav/clamd.conf');
  });
});
