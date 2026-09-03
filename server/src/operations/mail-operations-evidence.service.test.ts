import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MailOperationsEvidenceService, type MailOperationsEvidenceInput } from
  "./mail-operations-evidence.service.js";

const now = new Date("2026-08-31T09:00:00.000Z");
const commitSha = "a".repeat(40);

function validInput(): MailOperationsEvidenceInput {
  const providerEventId = "provider-event_2026.08.31:001";
  return {
    releaseId: "release-2026.08.31",
    preflightSha256: "1".repeat(64),
    bounceWebhookResponseSha256: "2".repeat(64),
    providerEventId,
    maximumAgeHours: 24,
    preflight: {
      ok: true,
      checkedAt: "2026-08-31T08:30:00.000Z",
      evidenceCommitSha: commitSha,
      checks: [{
        name: "smtp",
        status: "pass",
        detail: `dns=spf+dkim+dmarc; dmarcPolicy=reject; domainSha256=${"3".repeat(64)}; dkimSelectorSha256=${"4".repeat(64)}; dnsRecordsSha256=${"5".repeat(64)}; tcp=tls=auth=ok; bounceWebhook=configured; messageSent=false`,
      }],
      privateTarget: "smtp://user:password@example.com",
    },
    bounceWebhookResponse: {
      data: {
        accepted: true,
        action: "bounced",
        auditLogId: "audit_01ABCDEF",
        eventIdSha256: createHash("sha256").update(providerEventId).digest("hex"),
        messageId: "private-recipient@example.com",
      },
    },
  };
}

describe("MailOperationsEvidenceService", () => {
  it("binds a passing SMTP preflight to a real permanent-bounce audit record", () => {
    const report = new MailOperationsEvidenceService(() => now).run(validInput());

    expect(report).toMatchObject({
      ok: true,
      schemaVersion: 2,
      releaseId: "release-2026.08.31",
      commitSha,
      checkedAt: now.toISOString(),
      preflightCheckedAt: "2026-08-31T08:30:00.000Z",
      providerEventIdSha256: createHash("sha256").update("provider-event_2026.08.31:001").digest("hex"),
      auditLogId: "audit_01ABCDEF",
      dnsEvidence: {
        dmarcPolicy: "reject",
        domainSha256: "3".repeat(64),
        dkimSelectorSha256: "4".repeat(64),
        dnsRecordsSha256: "5".repeat(64),
      },
      artifacts: {
        preflightSha256: "1".repeat(64),
        bounceWebhookResponseSha256: "2".repeat(64),
      },
    });
    expect(report.evidenceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(report.checks.every(({ status }) => status === "pass")).toBe(true);
    expect(JSON.stringify(report)).not.toContain("private-recipient");
    expect(JSON.stringify(report)).not.toContain("password");
    expect(JSON.stringify(report)).not.toContain("provider-event_2026.08.31:001");
  });

  it("rejects failed SMTP authentication and an incomplete domain-authentication detail", () => {
    const input = validInput();
    const preflight = input.preflight as { ok: boolean; checks: Array<{ status: string; detail: string }> };
    preflight.ok = false;
    preflight.checks[0]!.status = "fail";
    preflight.checks[0]!.detail = "MAIL_DKIM_MISSING";
    const report = new MailOperationsEvidenceService(() => now).run(input);

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual({
      name: "smtpCheck", status: "fail", code: "MAIL_EVIDENCE_SMTP_CHECK_NOT_PASSED",
    });
    expect(report.checks).toContainEqual({
      name: "smtpDetail", status: "fail", code: "MAIL_EVIDENCE_SMTP_DETAIL_INCOMPLETE",
    });
  });

  it("rejects duplicate, unknown, or unaudited bounce responses", () => {
    const input = validInput();
    input.bounceWebhookResponse = { data: { accepted: true, action: "unchanged", auditLogId: null } };
    const report = new MailOperationsEvidenceService(() => now).run(input);

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual({
      name: "bounceWebhook", status: "fail", code: "MAIL_EVIDENCE_PERMANENT_BOUNCE_NOT_RECORDED",
    });
    expect(report.checks).toContainEqual({
      name: "bounceAuditLog", status: "fail", code: "MAIL_EVIDENCE_AUDIT_LOG_ID_MISSING",
    });
  });

  it("rejects a response produced for a different provider event", () => {
    const input = validInput();
    const response = input.bounceWebhookResponse as { data: { eventIdSha256: string } };
    response.data.eventIdSha256 = createHash("sha256").update("different-event").digest("hex");
    const report = new MailOperationsEvidenceService(() => now).run(input);
    expect(report.checks).toContainEqual({
      name: "providerEventCorrelation",
      status: "fail",
      code: "MAIL_EVIDENCE_PROVIDER_EVENT_MISMATCH",
    });
  });

  it("rejects stale and future preflight reports", () => {
    const stale = validInput();
    (stale.preflight as { checkedAt: string }).checkedAt = "2026-08-29T00:00:00.000Z";
    expect(new MailOperationsEvidenceService(() => now).run(stale).checks).toContainEqual({
      name: "preflightFreshness", status: "fail", code: "MAIL_EVIDENCE_PREFLIGHT_EXPIRED",
    });

    const future = validInput();
    (future.preflight as { checkedAt: string }).checkedAt = "2026-08-31T10:00:00.000Z";
    expect(new MailOperationsEvidenceService(() => now).run(future).checks).toContainEqual({
      name: "preflightTimestamp", status: "fail", code: "MAIL_EVIDENCE_PREFLIGHT_TIMESTAMP_INVALID",
    });
  });

  it.each([
    ["release ID", { releaseId: "../unsafe" }, "MAIL_EVIDENCE_RELEASE_ID_INVALID"],
    ["artifact hash", { preflightSha256: "bad" }, "MAIL_EVIDENCE_ARTIFACT_SHA256_INVALID"],
    ["provider event ID", { providerEventId: "recipient@example.com" }, "MAIL_EVIDENCE_PROVIDER_EVENT_ID_INVALID"],
    ["maximum age", { maximumAgeHours: 0 }, "MAIL_EVIDENCE_MAXIMUM_AGE_INVALID"],
  ])("rejects invalid %s input", (_label, override, code) => {
    expect(() => new MailOperationsEvidenceService(() => now).run({
      ...validInput(), ...override,
    })).toThrowError(expect.objectContaining({ name: code }));
  });

  it("cryptographically binds the provider event ID", () => {
    const service = new MailOperationsEvidenceService(() => now);
    const first = service.run(validInput());
    const changed = service.run({ ...validInput(), providerEventId: "provider-event_2026.08.31:002" });
    expect(changed.evidenceSha256).not.toBe(first.evidenceSha256);
  });
});
