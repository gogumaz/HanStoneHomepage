import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { connect } from "node:tls";
import { parse } from "dotenv";
import { validateDeploymentTarget } from "./operations/deployment-verification.service.js";
import { readReleaseEvidenceFile } from "./operations/release-evidence-file.js";
import {
  TransportSecurityEvidenceService,
  type TransportTlsEndpointEvidence,
} from "./operations/transport-security-evidence.service.js";

const MAX_ENVIRONMENT_BYTES = 256 * 1024;

function cliError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw cliError(`${name}_REQUIRED`);
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw cliError(`${name}_INVALID`);
  return value;
}

function isoCertificateDate(value: string): string | null {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

async function probeTlsEndpoint(value: string, timeoutMs: number): Promise<TransportTlsEndpointEvidence> {
  const url = new URL(validateDeploymentTarget(value));
  const hostname = url.hostname;
  const port = url.port ? Number(url.port) : 443;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, evidence?: TransportTlsEndpointEvidence) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error || !evidence) reject(error ?? cliError("TRANSPORT_TLS_PROBE_FAILED"));
      else resolve(evidence);
    };
    const socket = connect({
      host: hostname,
      port,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      ...(isIP(hostname) === 0 ? { servername: hostname } : {}),
    });
    socket.setTimeout(timeoutMs);
    socket.once("timeout", () => finish(cliError("TRANSPORT_TLS_PROBE_TIMEOUT")));
    socket.once("error", () => finish(cliError("TRANSPORT_TLS_PROBE_FAILED")));
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate(true);
      const protocol = socket.getProtocol();
      const validFrom = isoCertificateDate(certificate.valid_from);
      const validTo = isoCertificateDate(certificate.valid_to);
      if (!socket.authorized || !certificate.raw || !protocol || !validFrom || !validTo) {
        finish(cliError("TRANSPORT_TLS_CERTIFICATE_INVALID"));
        return;
      }
      finish(null, {
        originSha256: createHash("sha256").update(url.origin, "utf8").digest("hex"),
        protocol,
        certificateSha256: createHash("sha256").update(certificate.raw).digest("hex"),
        validFrom,
        validTo,
      });
    });
  });
}

async function environmentFile(path: string): Promise<{ environment: NodeJS.ProcessEnv; sha256: string }> {
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch {
    throw cliError("TRANSPORT_EVIDENCE_ENVIRONMENT_READ_FAILED");
  }
  if (!fileStat.isFile()) throw cliError("TRANSPORT_EVIDENCE_ENVIRONMENT_NOT_REGULAR");
  if (fileStat.size === 0 || fileStat.size > MAX_ENVIRONMENT_BYTES) {
    throw cliError("TRANSPORT_EVIDENCE_ENVIRONMENT_SIZE_INVALID");
  }
  let contents: Buffer;
  try {
    contents = await readFile(path);
  } catch {
    throw cliError("TRANSPORT_EVIDENCE_ENVIRONMENT_READ_FAILED");
  }
  const text = contents.toString("utf8");
  if (text.includes("\u0000") || text.includes("\uFFFD")) {
    throw cliError("TRANSPORT_EVIDENCE_ENVIRONMENT_ENCODING_INVALID");
  }
  const environment = parse(text);
  if (Object.keys(environment).length === 0) throw cliError("TRANSPORT_EVIDENCE_ENVIRONMENT_EMPTY");
  return { environment, sha256: createHash("sha256").update(contents).digest("hex") };
}

async function main(): Promise<void> {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED?.trim() === "0") {
    throw cliError("TRANSPORT_TLS_VERIFICATION_DISABLED");
  }
  const envFile = await environmentFile(required("TRANSPORT_EVIDENCE_ENV_FILE"));
  const preflight = await readReleaseEvidenceFile("preflight", required("TRANSPORT_EVIDENCE_PREFLIGHT_REPORT"));
  const deployment = await readReleaseEvidenceFile(
    "deploymentVerification",
    required("TRANSPORT_EVIDENCE_DEPLOYMENT_REPORT"),
  );
  const apiBaseUrl = required("TRANSPORT_EVIDENCE_API_BASE_URL");
  const webBaseUrl = required("TRANSPORT_EVIDENCE_WEB_BASE_URL");
  const tlsTimeoutMs = integer("TRANSPORT_EVIDENCE_TLS_TIMEOUT_MS", 5_000);
  if (tlsTimeoutMs < 1_000 || tlsTimeoutMs > 30_000) throw cliError("TRANSPORT_EVIDENCE_TLS_TIMEOUT_MS_INVALID");
  const [apiTls, webTls] = await Promise.all([
    probeTlsEndpoint(apiBaseUrl, tlsTimeoutMs),
    probeTlsEndpoint(webBaseUrl, tlsTimeoutMs),
  ]);
  const report = new TransportSecurityEvidenceService().run({
    releaseId: required("TRANSPORT_EVIDENCE_RELEASE_ID"),
    environment: envFile.environment,
    preflight: preflight.value,
    deploymentVerification: deployment.value,
    environmentSha256: envFile.sha256,
    preflightSha256: preflight.sha256,
    deploymentVerificationSha256: deployment.sha256,
    apiBaseUrl,
    webBaseUrl,
    maximumAgeHours: integer("TRANSPORT_EVIDENCE_MAX_AGE_HOURS", 24),
    minimumCertificateValidityDays: integer("TRANSPORT_EVIDENCE_MIN_CERT_VALIDITY_DAYS", 14),
    tlsEndpoints: { api: apiTls, web: webTls },
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const errorType = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,99}$/u.test(error.name)
    ? error.name : "UNKNOWN";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
