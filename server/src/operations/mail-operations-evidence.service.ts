import { createHash } from "node:crypto";

type JsonObject = Record<string, unknown>;
type EvidenceCheck = { name: string; status: "pass" | "fail"; code: string };

export type MailOperationsEvidenceInput = {
  releaseId: string;
  preflight: unknown;
  bounceWebhookResponse: unknown;
  preflightSha256: string;
  bounceWebhookResponseSha256: string;
  providerEventId: string;
  maximumAgeHours: number;
};

export type MailOperationsEvidenceReport = {
  ok: boolean;
  schemaVersion: 2;
  releaseId: string;
  commitSha: string | null;
  checkedAt: string;
  preflightCheckedAt: string | null;
  providerEventIdSha256: string;
  auditLogId: string | null;
  dnsEvidence: {
    dmarcPolicy: string | null;
    domainSha256: string | null;
    dkimSelectorSha256: string | null;
    dnsRecordsSha256: string | null;
  };
  artifacts: {
    preflightSha256: string;
    bounceWebhookResponseSha256: string;
  };
  checks: EvidenceCheck[];
  evidenceSha256: string;
};

const SMTP_PREFLIGHT_DETAIL = /^dns=spf\+dkim\+dmarc; dmarcPolicy=(quarantine|reject); domainSha256=([a-f0-9]{64}); dkimSelectorSha256=([a-f0-9]{64}); dnsRecordsSha256=([a-f0-9]{64}); tcp=tls=auth=ok; bounceWebhook=configured; messageSent=false$/u;

function evidenceError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function check(name: string, passed: boolean, code: string): EvidenceCheck {
  return { name, status: passed ? "pass" : "fail", code: passed ? "OK" : code };
}

function timestamp(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
}

export class MailOperationsEvidenceService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  run(input: MailOperationsEvidenceInput): MailOperationsEvidenceReport {
    if (!/^[A-Za-z0-9._-]{1,80}$/u.test(input.releaseId)) {
      throw evidenceError("MAIL_EVIDENCE_RELEASE_ID_INVALID");
    }
    if (!/^[a-fA-F0-9]{64}$/u.test(input.preflightSha256) ||
      !/^[a-fA-F0-9]{64}$/u.test(input.bounceWebhookResponseSha256)) {
      throw evidenceError("MAIL_EVIDENCE_ARTIFACT_SHA256_INVALID");
    }
    const providerEventId = input.providerEventId.trim();
    if (!/^[A-Za-z0-9._:-]{1,200}$/u.test(providerEventId)) {
      throw evidenceError("MAIL_EVIDENCE_PROVIDER_EVENT_ID_INVALID");
    }
    if (!Number.isInteger(input.maximumAgeHours) || input.maximumAgeHours < 1 || input.maximumAgeHours > 168) {
      throw evidenceError("MAIL_EVIDENCE_MAXIMUM_AGE_INVALID");
    }

    const preflight = object(input.preflight);
    const smtpChecks = Array.isArray(preflight?.checks)
      ? preflight.checks.map(object).filter((entry): entry is JsonObject => entry !== null && entry.name === "smtp")
      : [];
    const smtp = smtpChecks[0];
    const smtpDetail = typeof smtp?.detail === "string" ? SMTP_PREFLIGHT_DETAIL.exec(smtp.detail) : null;
    const commitSha = typeof preflight?.evidenceCommitSha === "string" &&
      /^[a-fA-F0-9]{40}$/u.test(preflight.evidenceCommitSha)
      ? preflight.evidenceCommitSha.toLowerCase() : null;
    const preflightAt = timestamp(preflight?.checkedAt);
    const now = this.now();
    const preflightAgeMs = preflightAt ? now.getTime() - preflightAt.getTime() : Number.POSITIVE_INFINITY;
    const preflightNotFuture = preflightAt !== null && preflightAgeMs >= -5 * 60_000;
    const preflightFresh = preflightAt !== null && preflightAgeMs >= 0 &&
      preflightAgeMs <= input.maximumAgeHours * 60 * 60_000;

    const responseRoot = object(input.bounceWebhookResponse);
    const response = object(responseRoot?.data) ?? responseRoot;
    const providerEventIdSha256 = createHash("sha256").update(providerEventId, "utf8").digest("hex");
    const auditLogId = typeof response?.auditLogId === "string" &&
      /^[A-Za-z0-9_-]{1,100}$/u.test(response.auditLogId)
      ? response.auditLogId : null;
    const checks = [
      check("preflight", preflight?.ok === true, "MAIL_EVIDENCE_PREFLIGHT_NOT_SUCCESSFUL"),
      check("candidateCommit", commitSha !== null, "MAIL_EVIDENCE_COMMIT_SHA_INVALID"),
      check("smtpCheck", smtpChecks.length === 1 && smtp?.status === "pass", "MAIL_EVIDENCE_SMTP_CHECK_NOT_PASSED"),
      check("smtpDetail", smtpDetail !== null, "MAIL_EVIDENCE_SMTP_DETAIL_INCOMPLETE"),
      check("preflightTimestamp", preflightNotFuture, "MAIL_EVIDENCE_PREFLIGHT_TIMESTAMP_INVALID"),
      check("preflightFreshness", preflightFresh, "MAIL_EVIDENCE_PREFLIGHT_EXPIRED"),
      check(
        "bounceWebhook",
        response?.accepted === true && response?.action === "bounced",
        "MAIL_EVIDENCE_PERMANENT_BOUNCE_NOT_RECORDED",
      ),
      check(
        "providerEventCorrelation",
        response?.eventIdSha256 === providerEventIdSha256,
        "MAIL_EVIDENCE_PROVIDER_EVENT_MISMATCH",
      ),
      check("bounceAuditLog", auditLogId !== null, "MAIL_EVIDENCE_AUDIT_LOG_ID_MISSING"),
    ];
    const checkedAt = now.toISOString();
    const dnsEvidence = {
      dmarcPolicy: smtpDetail?.[1] ?? null,
      domainSha256: smtpDetail?.[2] ?? null,
      dkimSelectorSha256: smtpDetail?.[3] ?? null,
      dnsRecordsSha256: smtpDetail?.[4] ?? null,
    };
    const artifacts = {
      preflightSha256: input.preflightSha256.toLowerCase(),
      bounceWebhookResponseSha256: input.bounceWebhookResponseSha256.toLowerCase(),
    };
    const source = JSON.stringify({
      schemaVersion: 2,
      releaseId: input.releaseId,
      commitSha,
      checkedAt,
      preflightCheckedAt: preflightAt?.toISOString() ?? null,
      providerEventIdSha256,
      auditLogId,
      dnsEvidence,
      artifacts,
      checks: checks.map(({ name, status }) => ({ name, status })),
    });
    return {
      ok: checks.every(({ status }) => status === "pass"),
      schemaVersion: 2,
      releaseId: input.releaseId,
      commitSha,
      checkedAt,
      preflightCheckedAt: preflightAt?.toISOString() ?? null,
      providerEventIdSha256,
      auditLogId,
      dnsEvidence,
      artifacts,
      checks,
      evidenceSha256: createHash("sha256").update(source, "utf8").digest("hex"),
    };
  }
}
