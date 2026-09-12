import { createHash } from "node:crypto";
import { resolveCname as nodeResolveCname, resolveTxt as nodeResolveTxt } from "node:dns/promises";

type TxtResolver = (hostname: string) => Promise<string[][]>;
type CnameResolver = (hostname: string) => Promise<string[]>;

export type MailDomainAuthenticationResult = {
  domain: string;
  dkimSelectors: string[];
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

async function readCname(hostname: string, resolver: CnameResolver): Promise<string[]> {
  try {
    return (await resolver(hostname)).map((value) => value.trim().toLowerCase().replace(/\.$/u, ""));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENODATA" || code === "ENOTFOUND") return [];
    throw new MailDomainAuthenticationError("MAIL_DNS_LOOKUP_FAILED");
  }
}

async function readDkimTxt(
  hostname: string,
  txtResolver: TxtResolver,
  cnameResolver: CnameResolver,
  visited = new Set<string>(),
): Promise<string[]> {
  if (visited.size >= 5 || visited.has(hostname)) {
    throw new MailDomainAuthenticationError("MAIL_DKIM_CNAME_INVALID");
  }
  visited.add(hostname);
  const direct = await readTxt(hostname, txtResolver);
  if (direct.some((record) => /^v=dkim1(?:\s*;|$)/iu.test(record))) return direct;
  const aliases = await readCname(hostname, cnameResolver);
  if (aliases.length === 0) return direct;
  if (aliases.length !== 1) throw new MailDomainAuthenticationError("MAIL_DKIM_CNAME_INVALID");
  return readDkimTxt(aliases[0]!, txtResolver, cnameResolver, visited);
}

function requireEnforcingSpf(record: string): void {
  const directives = record.trim().split(/\s+/u).slice(1).filter((term) => !term.includes("="));
  const allMechanisms = directives
    .map((term, index) => ({ index, match: /^([+?~-]?)all$/iu.exec(term) }))
    .filter((entry) => entry.match !== null);
  const terminal = allMechanisms[0];
  const qualifier = terminal?.match?.[1] || "+";
  if (
    allMechanisms.length !== 1
    || terminal?.index !== directives.length - 1
    || (qualifier !== "-" && qualifier !== "~")
  ) {
    throw new MailDomainAuthenticationError("MAIL_SPF_POLICY_INSUFFICIENT");
  }
}

function dmarcTagValues(record: string, name: string): string[] {
  return record.split(";").map((part) => part.trim()).flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator < 1 || part.slice(0, separator).trim().toLowerCase() !== name) return [];
    return [part.slice(separator + 1).trim().toLowerCase()];
  });
}

export async function verifyMailDomainAuthentication(
  input: { mailFrom: string; spfDomain?: string; dkimSelectors: string[] },
  resolver: TxtResolver = nodeResolveTxt,
  cnameResolver?: CnameResolver,
): Promise<MailDomainAuthenticationResult> {
  const domain = senderDomain(input.mailFrom);
  const spfDomain = (input.spfDomain ?? domain).trim().toLowerCase().replace(/\.$/u, "");
  if (
    spfDomain.length > 253
    || !spfDomain.includes(".")
    || (spfDomain !== domain && !spfDomain.endsWith(`.${domain}`))
    || spfDomain.split(".").some((label) => (
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)
    ))
  ) {
    throw new MailDomainAuthenticationError("MAIL_SPF_DOMAIN_INVALID");
  }
  const aliasResolver = cnameResolver ?? (resolver === nodeResolveTxt ? nodeResolveCname : async () => []);
  const dkimSelectors = input.dkimSelectors.map((value) => value.trim().toLowerCase());
  if (
    dkimSelectors.length === 0
    || dkimSelectors.length > 10
    || new Set(dkimSelectors).size !== dkimSelectors.length
    || dkimSelectors.some((selector) => !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(selector))
  ) {
    throw new MailDomainAuthenticationError("MAIL_DKIM_SELECTOR_INVALID");
  }

  const [rootRecords, dmarcRecords, ...dkimRecordSets] = await Promise.all([
    readTxt(spfDomain, resolver),
    readTxt(`_dmarc.${domain}`, resolver),
    ...dkimSelectors.map((selector) => readDkimTxt(
      `${selector}._domainkey.${domain}`,
      resolver,
      aliasResolver,
    )),
  ]);
  const spf = rootRecords.filter((record) => /^v=spf1(?:\s|$)/iu.test(record));
  if (spf.length !== 1) {
    throw new MailDomainAuthenticationError(spf.length ? "MAIL_SPF_MULTIPLE" : "MAIL_SPF_MISSING");
  }
  requireEnforcingSpf(spf[0]!);
  const dmarc = dmarcRecords.filter((record) => /^v=dmarc1(?:\s*;|$)/iu.test(record));
  if (dmarc.length !== 1) {
    throw new MailDomainAuthenticationError(dmarc.length ? "MAIL_DMARC_MULTIPLE" : "MAIL_DMARC_MISSING");
  }
  const policies = dmarcTagValues(dmarc[0]!, "p");
  if (policies.length !== 1) {
    throw new MailDomainAuthenticationError("MAIL_DMARC_RECORD_INVALID");
  }
  const policy = policies[0];
  if (policy !== "quarantine" && policy !== "reject") {
    throw new MailDomainAuthenticationError("MAIL_DMARC_POLICY_INSUFFICIENT");
  }
  const percentages = dmarcTagValues(dmarc[0]!, "pct");
  if (percentages.length > 1 || (percentages.length === 1 && percentages[0] !== "100")) {
    throw new MailDomainAuthenticationError("MAIL_DMARC_PERCENTAGE_INSUFFICIENT");
  }
  const validDkim = dkimRecordSets.every((records) => records.some((record) => (
    /^v=dkim1(?:\s*;|$)/iu.test(record)
    && /(?:^|;)\s*p=[a-z0-9+/=]+(?:;|\s|$)/iu.test(record)
  )));
  if (!validDkim) {
    throw new MailDomainAuthenticationError("MAIL_DKIM_MISSING");
  }

  const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
  const canonicalRecords = JSON.stringify({
    spfDomain,
    spf: [...spf].sort(),
    dmarc: [...dmarc].sort(),
    dkim: dkimSelectors.map((selector, index) => ({
      selector,
      records: [...(dkimRecordSets[index] ?? [])
        .filter((record) => /^v=dkim1(?:\s*;|$)/iu.test(record))].sort(),
    })),
  });
  return {
    domain,
    dkimSelectors,
    dmarcPolicy: policy,
    domainSha256: sha256(domain),
    dkimSelectorSha256: sha256(JSON.stringify([...dkimSelectors].sort())),
    dnsRecordsSha256: sha256(canonicalRecords),
  };
}
