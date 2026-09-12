import { describe, expect, it, vi } from "vitest";
import {
  MailDomainAuthenticationError,
  verifyMailDomainAuthentication,
} from "./mail-domain-authentication.js";

function resolver(records: Record<string, string[]>) {
  return vi.fn(async (hostname: string) => (records[hostname] ?? []).map((record) => [record]));
}

describe("mail domain authentication", () => {
  it("verifies one SPF record, a signing DKIM key, and an enforcing DMARC policy", async () => {
    const lookup = resolver({
      "example.com": ["v=spf1 include:_spf.mail.example ~all"],
      "_dmarc.example.com": ["v=DMARC1; p=reject; pct=100; rua=mailto:dmarc@example.com"],
      "mail2026._domainkey.example.com": ["v=DKIM1; k=rsa; p=QUJDREVGRw=="],
    });

    const result = await verifyMailDomainAuthentication({
      mailFrom: "바둑타고 <no-reply@example.com>",
      dkimSelectors: ["mail2026"],
    }, lookup);
    expect(result).toMatchObject({
      domain: "example.com",
      dkimSelectors: ["mail2026"],
      dmarcPolicy: "reject",
    });
    expect(result.domainSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.dkimSelectorSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.dnsRecordsSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it("changes the DNS evidence digest when a public policy record changes", async () => {
    const common = {
      "_dmarc.example.com": ["v=DMARC1; p=reject"],
      "mail2026._domainkey.example.com": ["v=DKIM1; p=QUJDREVGRw=="],
    };
    const first = await verifyMailDomainAuthentication({
      mailFrom: "no-reply@example.com", dkimSelectors: ["mail2026"],
    }, resolver({ ...common, "example.com": ["v=spf1 include:first.example -all"] }));
    const changed = await verifyMailDomainAuthentication({
      mailFrom: "no-reply@example.com", dkimSelectors: ["mail2026"],
    }, resolver({ ...common, "example.com": ["v=spf1 include:second.example -all"] }));
    expect(changed.dnsRecordsSha256).not.toBe(first.dnsRecordsSha256);
    expect(changed.domainSha256).toBe(first.domainSha256);
  });

  it("verifies every Resend DKIM selector through its CNAME target", async () => {
    const lookup = resolver({
      "send.notify.example.com": ["v=spf1 include:amazonses.com ~all"],
      "_dmarc.notify.example.com": ["v=DMARC1; p=quarantine"],
      "first.dkim.amazonses.com": ["v=DKIM1; k=rsa; p=QUJDREVGRw=="],
      "second.dkim.amazonses.com": ["v=DKIM1; k=rsa; p=SElKS0xNTg=="],
    });
    const aliases: Record<string, string[]> = {
      "first._domainkey.notify.example.com": ["first.dkim.amazonses.com."],
      "second._domainkey.notify.example.com": ["second.dkim.amazonses.com."],
    };
    const cnameLookup = vi.fn(async (hostname: string) => aliases[hostname] ?? []);

    const result = await verifyMailDomainAuthentication({
      mailFrom: "no-reply@notify.example.com",
      spfDomain: "send.notify.example.com",
      dkimSelectors: ["first", "second"],
    }, lookup, cnameLookup);

    expect(result.dkimSelectors).toEqual(["first", "second"]);
    expect(result.dkimSelectorSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(cnameLookup).toHaveBeenCalledTimes(2);
  });

  it("does not mistake the From domain SPF for Resend's MAIL FROM SPF", async () => {
    const lookup = resolver({
      "notify.example.com": ["v=spf1 ip4:192.0.2.1 ~all"],
      "_dmarc.notify.example.com": ["v=DMARC1; p=reject"],
      "mail2026._domainkey.notify.example.com": ["v=DKIM1; p=QUJDREVGRw=="],
    });

    await expect(verifyMailDomainAuthentication({
      mailFrom: "no-reply@notify.example.com",
      spfDomain: "send.notify.example.com",
      dkimSelectors: ["mail2026"],
    }, lookup)).rejects.toMatchObject({ code: "MAIL_SPF_MISSING" });
    expect(lookup).toHaveBeenCalledWith("send.notify.example.com");
  });

  it("rejects an SPF domain that is not aligned below the From domain", async () => {
    await expect(verifyMailDomainAuthentication({
      mailFrom: "no-reply@notify.example.com",
      spfDomain: "send.unrelated.example.net",
      dkimSelectors: ["mail2026"],
    }, resolver({}))).rejects.toMatchObject({ code: "MAIL_SPF_DOMAIN_INVALID" });
  });

  it.each([
    [{}, "MAIL_SPF_MISSING"],
    [{ "example.com": ["v=spf1 -all", "v=spf1 include:mail.example -all"] }, "MAIL_SPF_MULTIPLE"],
    [{ "example.com": ["v=spf1 -all"] }, "MAIL_DMARC_MISSING"],
    [{
      "example.com": ["v=spf1 -all"],
      "_dmarc.example.com": ["v=DMARC1; p=none"],
    }, "MAIL_DMARC_POLICY_INSUFFICIENT"],
    [{
      "example.com": ["v=spf1 -all"],
      "_dmarc.example.com": ["v=DMARC1; p=quarantine"],
    }, "MAIL_DKIM_MISSING"],
    [{
      "example.com": ["v=spf1 +all"],
      "_dmarc.example.com": ["v=DMARC1; p=reject"],
      "mail2026._domainkey.example.com": ["v=DKIM1; p=QUJDREVGRw=="],
    }, "MAIL_SPF_POLICY_INSUFFICIENT"],
    [{
      "example.com": ["v=spf1 include:_spf.example.com"],
      "_dmarc.example.com": ["v=DMARC1; p=reject"],
      "mail2026._domainkey.example.com": ["v=DKIM1; p=QUJDREVGRw=="],
    }, "MAIL_SPF_POLICY_INSUFFICIENT"],
    [{
      "example.com": ["v=spf1 -all"],
      "_dmarc.example.com": ["v=DMARC1; p=reject; pct=0"],
      "mail2026._domainkey.example.com": ["v=DKIM1; p=QUJDREVGRw=="],
    }, "MAIL_DMARC_PERCENTAGE_INSUFFICIENT"],
    [{
      "example.com": ["v=spf1 -all"],
      "_dmarc.example.com": ["v=DMARC1; p=reject; p=none"],
      "mail2026._domainkey.example.com": ["v=DKIM1; p=QUJDREVGRw=="],
    }, "MAIL_DMARC_RECORD_INVALID"],
  ] as const)("rejects incomplete DNS policy %#", async (records, code) => {
    await expect(verifyMailDomainAuthentication({
      mailFrom: "no-reply@example.com",
      dkimSelectors: ["mail2026"],
    }, resolver(records as Record<string, string[]>))).rejects.toMatchObject({
      name: code,
      code,
    } satisfies Partial<MailDomainAuthenticationError>);
  });
});
