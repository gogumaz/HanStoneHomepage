import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const composePath = resolve(process.cwd(), "../compose.yaml");

function serviceBlock(compose: string, serviceName: string): string {
  const marker = `\n  ${serviceName}:\n`;
  const start = compose.indexOf(marker);
  if (start < 0) throw new Error(`Missing runtime Compose service: ${serviceName}`);
  const contentStart = start + marker.length;
  const remaining = compose.slice(contentStart);
  const nextServiceOffset = remaining.search(/\n  \S/gu);
  return remaining.slice(0, nextServiceOffset < 0 ? remaining.length : nextServiceOffset);
}

describe("runtime Compose worker contract", () => {
  const compose = `\n${readFileSync(composePath, "utf8").replace(/\r\n/gu, "\n")}`;

  it("runs all non-storage background jobs from the API image", () => {
    for (const serviceName of [
      "inquiry-notification-worker",
      "account-mail-worker",
      "assignment-reminder-worker",
    ]) {
      expect(serviceBlock(compose, serviceName), serviceName).toContain(
        "image: ${API_IMAGE:-hanstone-api:latest}",
      );
    }
  });

  it("makes restart persistence explicit and configurable for every service", () => {
    expect(compose.match(/restart: \$\{COMPOSE_RESTART_POLICY:-no\}/gu)).toHaveLength(10);
  });

  it("passes the Resend webhook and encrypted account-mail settings to the API", () => {
    const api = serviceBlock(compose, "api");
    expect(api).toContain("RESEND_WEBHOOK_SECRET: ${RESEND_WEBHOOK_SECRET:-}");
    expect(api).toContain("ACCOUNT_MAIL_ENCRYPTION_KEY_BASE64: ${ACCOUNT_MAIL_ENCRYPTION_KEY_BASE64:-}");
    expect(api).toContain("OPERATIONS_METRICS_TOKEN: ${OPERATIONS_METRICS_TOKEN:-}");
  });

  it("passes SMTP and encryption settings to the account-mail worker", () => {
    const worker = serviceBlock(compose, "account-mail-worker");
    expect(worker).toContain('command: ["node", "dist/account-mail-worker.js"]');
    expect(worker).toContain("SMTP_PASSWORD: ${SMTP_PASSWORD:-}");
    expect(worker).toContain("ACCOUNT_MAIL_ENCRYPTION_KEY_BASE64: ${ACCOUNT_MAIL_ENCRYPTION_KEY_BASE64:-}");
  });
});
