export type ReleaseIdentity = {
  commitSha: string;
  imageDigest: string;
};

function identityError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

export function parseReleaseIdentity(value: unknown): ReleaseIdentity {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw identityError("DEPLOYMENT_IDENTITY_INVALID");
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.commitSha !== "string" || !/^[a-fA-F0-9]{40}$/.test(candidate.commitSha)) {
    throw identityError("DEPLOYMENT_COMMIT_SHA_INVALID");
  }
  if (typeof candidate.imageDigest !== "string" || !/^sha256:[a-fA-F0-9]{64}$/.test(candidate.imageDigest)) {
    throw identityError("DEPLOYMENT_IMAGE_DIGEST_INVALID");
  }
  return { commitSha: candidate.commitSha.toLowerCase(), imageDigest: candidate.imageDigest.toLowerCase() };
}

export function loadReleaseIdentity(env: NodeJS.ProcessEnv = process.env): ReleaseIdentity {
  return parseReleaseIdentity({
    commitSha: env.DEPLOYMENT_COMMIT_SHA?.trim(),
    imageDigest: env.DEPLOYMENT_IMAGE_DIGEST?.trim(),
  });
}
