import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const composePath = resolve(process.cwd(), "../deploy/compose.production.yaml");
const environmentExamplePath = resolve(process.cwd(), "../deploy/production.env.example");

describe("production Resend deployment", () => {
  it("pins every production mail process to authenticated Resend STARTTLS", async () => {
    const compose = await readFile(composePath, "utf8");

    expect(compose.match(/SMTP_HOST: \$\{SMTP_HOST:-smtp\.resend\.com\}/gu)).toHaveLength(6);
    expect(compose.match(/SMTP_PORT: \$\{SMTP_PORT:-587\}/gu)).toHaveLength(6);
    expect(compose.match(/SMTP_SECURE: \$\{SMTP_SECURE:-false\}/gu)).toHaveLength(6);
    expect(compose.match(/SMTP_REQUIRE_TLS: \$\{SMTP_REQUIRE_TLS:-true\}/gu)).toHaveLength(6);
    expect(compose.match(/SMTP_USER: \$\{SMTP_USER:-resend\}/gu)).toHaveLength(6);
    expect(compose.match(/SMTP_PASSWORD: \$\{SMTP_PASSWORD:\?SMTP_PASSWORD must be set to the Resend API key\}/gu))
      .toHaveLength(6);
    expect(compose).toContain(
      "MAIL_SPF_DOMAIN: ${MAIL_SPF_DOMAIN:?MAIL_SPF_DOMAIN must be set to the Resend MAIL FROM domain}",
    );
    expect(compose).toContain(
      "MAIL_DKIM_SELECTORS: ${MAIL_DKIM_SELECTORS:?MAIL_DKIM_SELECTORS must contain every Resend DKIM selector}",
    );
    expect(compose).toContain(
      "RESEND_WEBHOOK_SECRET: ${RESEND_WEBHOOK_SECRET:?RESEND_WEBHOOK_SECRET must be set}",
    );
  });

  it("uses a dedicated transactional subdomain without storing an API key", async () => {
    const environment = await readFile(environmentExamplePath, "utf8");

    expect(environment).toContain("SMTP_HOST=smtp.resend.com");
    expect(environment).toContain("SMTP_USER=resend");
    expect(environment).toContain("SMTP_PASSWORD=re_운영_RESEND_API_KEY");
    expect(environment).toContain('MAIL_FROM="바둑타고 <no-reply@notify.handol-edu.com>"');
    expect(environment).toContain("MAIL_SPF_DOMAIN=send.notify.handol-edu.com");
    expect(environment).toContain(
      "MAIL_DKIM_SELECTORS=replace_with_resend_dkim_selector_1,replace_with_resend_dkim_selector_2,replace_with_resend_dkim_selector_3",
    );
    expect(environment).toContain("RESEND_WEBHOOK_SECRET=whsec_replace_with_resend_signing_secret");
    expect(environment).not.toMatch(/^SMTP_PASSWORD=re_[A-Za-z0-9]{20,}$/mu);
  });
});
