import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ReleaseEvidenceName } from "./release-acceptance.service.js";

export type ReleaseJsonArtifactName = ReleaseEvidenceName | "acceptance" | "deploymentVerification" | "closeout" |
  "mailBounceWebhook" | "stagingBundle" | "transportSecurity" | "mailOperations" | "legalApproval" |
  "legalApprovalBinding";

const MAX_REPORT_BYTES = 1024 * 1024;

function evidenceFileError(name: ReleaseJsonArtifactName, suffix: string): Error {
  const code = `RELEASE_${name.toUpperCase()}_REPORT_${suffix}`;
  const error = new Error(code);
  error.name = code;
  return error;
}

export async function readReleaseEvidenceFile(
  name: ReleaseJsonArtifactName,
  path: string,
): Promise<{ value: unknown; sha256: string }> {
  let contents: Buffer;
  try {
    contents = await readFile(path);
  } catch {
    throw evidenceFileError(name, "READ_FAILED");
  }
  if (contents.byteLength > MAX_REPORT_BYTES) throw evidenceFileError(name, "TOO_LARGE");
  try {
    return {
      value: JSON.parse(contents.toString("utf8")),
      sha256: createHash("sha256").update(contents).digest("hex"),
    };
  } catch {
    throw evidenceFileError(name, "JSON_INVALID");
  }
}
