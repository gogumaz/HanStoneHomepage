export function evidenceCommitSha(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.EVIDENCE_COMMIT_SHA?.trim() || env.GITHUB_SHA?.trim();
  if (!value) return null;
  if (!/^[a-fA-F0-9]{40}$/.test(value)) {
    const error = new Error("EVIDENCE_COMMIT_SHA_INVALID");
    error.name = "EVIDENCE_COMMIT_SHA_INVALID";
    throw error;
  }
  return value.toLowerCase();
}

export function withEvidenceCommitSha<T extends object>(report: T, env: NodeJS.ProcessEnv = process.env): T & {
  commitSha?: string;
} {
  const commitSha = evidenceCommitSha(env);
  return commitSha ? { ...report, commitSha } : report;
}
