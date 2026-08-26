import { describe, expect, it } from "vitest";
import { evidenceCommitSha, withEvidenceCommitSha } from "./evidence-metadata.js";

describe("evidence metadata", () => {
  it("uses an explicit candidate SHA before the GitHub SHA", () => {
    expect(evidenceCommitSha({ EVIDENCE_COMMIT_SHA: "A".repeat(40), GITHUB_SHA: "1".repeat(40) })).toBe("a".repeat(40));
    expect(withEvidenceCommitSha({ ok: true }, { GITHUB_SHA: "A".repeat(40) })).toEqual({
      ok: true,
      commitSha: "a".repeat(40),
    });
  });

  it("keeps standalone reports compatible and rejects invalid metadata", () => {
    expect(withEvidenceCommitSha({ ok: true }, {})).toEqual({ ok: true });
    expect(() => evidenceCommitSha({ EVIDENCE_COMMIT_SHA: "not-a-sha" })).toThrowError(
      expect.objectContaining({ name: "EVIDENCE_COMMIT_SHA_INVALID" }),
    );
    expect(() => evidenceCommitSha({ EVIDENCE_COMMIT_SHA: "abcdef1" })).toThrowError(
      expect.objectContaining({ name: "EVIDENCE_COMMIT_SHA_INVALID" }),
    );
  });
});
