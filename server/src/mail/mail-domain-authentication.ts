import { createHash } from "node:crypto";
import { resolveTxt as nodeResolveTxt } from "node:dns/promises";

type TxtResolver = (hostname: string) => Promise<string[][]>;

export type MailDomainAuthenticationResult = {
  domain: string;
  dkimSelector: string;
  dmarcPolicy: "quarantine" | "reject";
  domainSha256: string;
  dkimSelectorSha256: string;
  dnsRecordsSha256: string;
};

export class MailDomainAuthenticationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = code;
  }
}

function senderDomain(mailFrom: string): string {
  const match = mailFrom.trim().match(/@([a-z0-9.-]+)(?:>|\s*$)/iu);
  const domain = match?.[1]?.toLowerCase().replace(/\.$/u, "") ?? "";
  if (!domain || domain.length > 253 || !domain.includes(".")) {
    throw new MailDomainAuthenticationError("MAIL_FROM_DOMAIN_INVALID");
  }
  return domain;
}

async function readTxt(hostname: string, resolver: TxtResolver): Promise<string[]> {
  try {
    return (await resolver(hostname)).map((chunks) => chunks.join("").trim());
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENODATA" || code === "ENOTFOUND") return [];
    throw new MailDomainAuthenticationError("MAIL_DNS_LOOKUP_FAILED");
  }
}

export async function verifyMailDomainAuthentication(
  input: { mailFrom: string; dkimSelector: string },
  resolver: TxtResolver = nodeResolveTxt,
): Promise<MailDomainAuthenticationResult> {
  const domain = senderDomain(input.mailFrom);
  const dkimSelector = input.dkimSelector.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(dkimSelector)) {
    throw new MailDomainAuthenticationError("MAIL_DKIM_SELECTOR_INVALID");
  }

  const [rootRecords, dmarcRecords, dkimRecords] = await Promise.all([
    readTxt(domain, resolver),
    readTxt(`_dmarc.${domain}`, resolver),
    readTxt(`${dkimSelector}._domainkey.${domain}`, resolver),
  ]);
  const spf = rootRecords.filter((record) => /^v=spf1(?:\s|$)/iu.test(record));
  if (spf.length !== 1) {
    throw new MailDomainAuthenticationError(spf.length ? "MAIL_SPF_MULTIPLE" : "MAIL_SPF_MISSING");
  }
  const dmarc = dmarcRecords.filter((record) => /^v=dmarc1(?:\s*;|$)/iu.test(record));
  if (dmarc.length !== 1) {
    throw new MailDomainAuthenticationError(dmarc.length ? "MAIL_DMARC_MULTIPLE" : "MAIL_DMARC_MISSING");
  }
  const policy = dmarc[0]?.match(/(?:^|;)\s*p=(none|quarantine|reject)(?:;|\s|$)/iu)?.[1]?.toLowerCase();
  if (policy !== "quarantine" && policy !== "reject") {
    throw new MailDomainAuthenticationError("MAIL_DMARC_POLICY_INSUFFICIENT");
  }
  const dkim = dkimRecords.find((record) => (
    /^v=dkim1(?:\s*;|$)/iu.test(record)
    && /(?:^|;)\s*p=[a-z0-9+/=]+(?:;|\s|$)/iu.test(record)
  ));
  if (!dkim) {
    throw new MailDomainAuthenticationError("MAIL_DKIM_MISSING");
  }

  const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
  const canonicalRecords = JSON.stringify({
    spf: [...spf].sort(),
    dmarc: [...dmarc].sort(),
    dkim: [...dkimRecords.filter((record) => /^v=dkim1(?:\s*;|$)/iu.test(record))].sort(),
  });
  return {
    domain,
    dkimSelector,
    dmarcPolicy: policy,
    domainSha256: sha256(domain),
    dkimSelectorSha256: sha256(dkimSelector),
    dnsRecordsSha256: sha256(canonicalRecords),
  };
}
