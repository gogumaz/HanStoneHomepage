import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_LEGAL_POLICY_VERSION } from "../common/legal-policy.js";

const composePath = resolve(process.cwd(), "../deploy/compose.production.yaml");
const environmentExamplePath = resolve(process.cwd(), "../deploy/production.env.example");
const serviceNames = [
  "api",
  "video-scan-worker",
  "inquiry-notification-worker",
  "account-mail-worker",
  "video-cleanup-worker",
  "hls-transcode-worker",
] as const;

function serviceBlock(compose: string, serviceName: string): string {
  const marker = `\n  ${serviceName}:\n`;
  const start = compose.indexOf(marker);
  if (start < 0) throw new Error(`Missing production Compose service: ${serviceName}`);
  const contentStart = start + marker.length;
  const remaining = compose.slice(contentStart);
  const nextServiceOffset = remaining.search(/\n  \S/gu);
  return remaining.slice(0, nextServiceOffset < 0 ? remaining.length : nextServiceOffset);
}

describe("production legal-policy deployment contract", () => {
  it("injects fail-closed legal approval metadata into every production process", () => {
    const compose = `\n${readFileSync(composePath, "utf8").replace(/\r\n/gu, "\n")}`;

    for (const serviceName of serviceNames) {
      const block = serviceBlock(compose, serviceName);
      expect(block, serviceName).toContain("LEGAL_POLICY_VERSION: ${LEGAL_POLICY_VERSION:?");
      expect(block, serviceName).toContain("LEGAL_POLICY_APPROVED_AT: ${LEGAL_POLICY_APPROVED_AT:?");
      expect(block, serviceName).toContain("LEGAL_POLICY_APPROVAL_SHA256: ${LEGAL_POLICY_APPROVAL_SHA256:?");
    }
  });

  it("publishes the current version and explicit approval placeholders in the environment example", () => {
    const environmentExample = readFileSync(environmentExamplePath, "utf8");
    expect(environmentExample).toContain(`LEGAL_POLICY_VERSION=${CURRENT_LEGAL_POLICY_VERSION}`);
    expect(environmentExample).toMatch(/^LEGAL_POLICY_APPROVED_AT=.+$/mu);
    expect(environmentExample).toMatch(/^LEGAL_POLICY_APPROVAL_SHA256=.+$/mu);
  });
});
