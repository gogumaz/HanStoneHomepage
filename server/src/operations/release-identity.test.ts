import { describe, expect, it } from "vitest";
import { loadReleaseIdentity, parseReleaseIdentity } from "./release-identity.js";

describe("release identity", () => {
  it("normalizes a valid immutable deployment identity", () => {
    expect(loadReleaseIdentity({
      DEPLOYMENT_COMMIT_SHA: "A".repeat(40),
      DEPLOYMENT_IMAGE_DIGEST: `sha256:${"A".repeat(64)}`,
    })).toEqual({ commitSha: "a".repeat(40), imageDigest: `sha256:${"a".repeat(64)}` });
  });

  it("rejects missing, mutable, and malformed identity values", () => {
    expect(() => loadReleaseIdentity({})).toThrowError(expect.objectContaining({ name: "DEPLOYMENT_COMMIT_SHA_INVALID" }));
    expect(() => parseReleaseIdentity({ commitSha: "main", imageDigest: `sha256:${"a".repeat(64)}` }))
      .toThrowError(expect.objectContaining({ name: "DEPLOYMENT_COMMIT_SHA_INVALID" }));
    expect(() => parseReleaseIdentity({ commitSha: "a".repeat(40), imageDigest: "latest" }))
      .toThrowError(expect.objectContaining({ name: "DEPLOYMENT_IMAGE_DIGEST_INVALID" }));
    expect(() => parseReleaseIdentity({ commitSha: "abcdef1", imageDigest: `sha256:${"a".repeat(64)}` }))
      .toThrowError(expect.objectContaining({ name: "DEPLOYMENT_COMMIT_SHA_INVALID" }));
  });
});
