import { createHash } from "node:crypto";
import { validateDeploymentTarget } from "./deployment-verification.service.js";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const REVALIDATE_CACHE_CONTROL = "public,max-age=0,must-revalidate";
const IMMUTABLE_CACHE_CONTROL = "public,max-age=31536000,immutable";

type JsonObject = Record<string, unknown>;
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
type VerificationCheck = { name: string; status: "pass" | "fail"; code: string };

export type WebDeploymentVerificationConfig = {
  baseUrl: string;
  expectedCommitSha: string;
  expectedManifestSha256: string;
  requestTimeoutMs: number;
};

export type WebDeploymentVerificationReport = {
  ok: boolean;
  checkedAt: string;
  expected: { commitSha: string; manifestSha256: string };
  checks: VerificationCheck[];
};

function verificationError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function check(name: string, passed: boolean, code: string): VerificationCheck {
  return { name, status: passed ? "pass" : "fail", code: passed ? "OK" : code };
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function safePath(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/.test(value)) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function cachePolicyMatches(value: string | null, expected: string): boolean {
  if (!value) return false;
  const actual = new Set(value.toLowerCase().split(",").map((part) => part.trim()).filter(Boolean));
  const required = new Set(expected.split(","));
  return actual.size === required.size && [...required].every((part) => actual.has(part));
}

function contentTypeMatches(value: string | null, expected: unknown): boolean {
  if (!value || typeof expected !== "string") return false;
  return value.split(";", 1)[0]?.trim().toLowerCase() === expected.split(";", 1)[0]?.trim().toLowerCase();
}

async function responseBytes(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
    await response.body?.cancel();
    throw verificationError("WEB_DEPLOYMENT_BODY_TOO_LARGE");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw verificationError("WEB_DEPLOYMENT_BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function failureType(error: unknown): string {
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(error.name)
    ? error.name : "WEB_DEPLOYMENT_FETCH_FAILED";
}

export class WebDeploymentVerificationService {
  constructor(
    private readonly fetcher: Fetcher = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async run(config: WebDeploymentVerificationConfig): Promise<WebDeploymentVerificationReport> {
    if (!/^[a-fA-F0-9]{40}$/.test(config.expectedCommitSha)) {
      throw verificationError("WEB_DEPLOYMENT_COMMIT_SHA_INVALID");
    }
    if (!/^[a-fA-F0-9]{64}$/.test(config.expectedManifestSha256)) {
      throw verificationError("WEB_DEPLOYMENT_MANIFEST_SHA256_INVALID");
    }
    if (!Number.isInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 100 || config.requestTimeoutMs > 60_000) {
      throw verificationError("WEB_DEPLOYMENT_TIMEOUT_INVALID");
    }
    const baseUrl = new URL(validateDeploymentTarget(config.baseUrl));
    const expected = {
      commitSha: config.expectedCommitSha.toLowerCase(),
      manifestSha256: config.expectedManifestSha256.toLowerCase(),
    };
    const request = async (path: string, maximumBytes: number): Promise<{ response: Response; bytes: Uint8Array }> => {
      const response = await this.fetcher(new URL(path, baseUrl), {
        method: "GET",
        headers: { accept: "*/*" },
        redirect: "manual",
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        throw verificationError(`WEB_DEPLOYMENT_HTTP_${response.status}`);
      }
      return { response, bytes: await responseBytes(response, maximumBytes) };
    };

    try {
      const manifestResult = await request("/web-deployment-manifest.json", MAX_MANIFEST_BYTES);
      let manifestValue: unknown;
      try {
        manifestValue = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestResult.bytes));
      } catch {
        throw verificationError("WEB_DEPLOYMENT_MANIFEST_JSON_INVALID");
      }
      const manifest = object(manifestValue);
      const files = Array.isArray(manifest?.files) ? manifest.files.map(object) : [];
      const index = files.find((file) => file?.path === "index.html") ?? null;
      const asset = files.find((file) => safePath(file?.path) && String(file?.path).startsWith("assets/")) ?? null;
      const manifestChecks = [
        check("manifestSha256", sha256(manifestResult.bytes) === expected.manifestSha256, "WEB_DEPLOYMENT_MANIFEST_MISMATCH"),
        check("manifestSchema", manifest?.ok === true && manifest?.schemaVersion === 1, "WEB_DEPLOYMENT_MANIFEST_SCHEMA_INVALID"),
        check("manifestCommit", manifest?.commitSha === expected.commitSha, "WEB_DEPLOYMENT_COMMIT_MISMATCH"),
        check("manifestCacheControl", cachePolicyMatches(
          manifestResult.response.headers.get("cache-control"), REVALIDATE_CACHE_CONTROL,
        ), "WEB_DEPLOYMENT_MANIFEST_CACHE_POLICY_INVALID"),
        check("manifestContentType", contentTypeMatches(
          manifestResult.response.headers.get("content-type"), "application/json",
        ), "WEB_DEPLOYMENT_MANIFEST_CONTENT_TYPE_INVALID"),
        check("indexInventory", index !== null && safePath(index.path), "WEB_DEPLOYMENT_INDEX_MISSING"),
        check("assetInventory", asset !== null && safePath(asset.path), "WEB_DEPLOYMENT_ASSET_MISSING"),
      ];
      if (manifestChecks.some(({ status }) => status === "fail") || !index || !asset ||
          !safePath(index.path) || !safePath(asset.path)) {
        return { ok: false, checkedAt: this.now().toISOString(), expected, checks: manifestChecks };
      }

      const [indexResult, assetResult] = await Promise.all([
        request(index.path, MAX_FILE_BYTES),
        request(asset.path, MAX_FILE_BYTES),
      ]);
      const checks = [
        ...manifestChecks,
        check("indexSha256", typeof index.sha256 === "string" && sha256(indexResult.bytes) === index.sha256.toLowerCase(),
          "WEB_DEPLOYMENT_INDEX_MISMATCH"),
        check("indexCacheControl", index.cacheControl === REVALIDATE_CACHE_CONTROL && cachePolicyMatches(
          indexResult.response.headers.get("cache-control"), REVALIDATE_CACHE_CONTROL,
        ), "WEB_DEPLOYMENT_INDEX_CACHE_POLICY_INVALID"),
        check("indexContentType", contentTypeMatches(indexResult.response.headers.get("content-type"), index.contentType),
          "WEB_DEPLOYMENT_INDEX_CONTENT_TYPE_INVALID"),
        check("assetSha256", typeof asset.sha256 === "string" && sha256(assetResult.bytes) === asset.sha256.toLowerCase(),
          "WEB_DEPLOYMENT_ASSET_MISMATCH"),
        check("assetCacheControl", asset.cacheControl === IMMUTABLE_CACHE_CONTROL && cachePolicyMatches(
          assetResult.response.headers.get("cache-control"), IMMUTABLE_CACHE_CONTROL,
        ), "WEB_DEPLOYMENT_ASSET_CACHE_POLICY_INVALID"),
        check("assetContentType", contentTypeMatches(assetResult.response.headers.get("content-type"), asset.contentType),
          "WEB_DEPLOYMENT_ASSET_CONTENT_TYPE_INVALID"),
      ];
      return {
        ok: checks.every(({ status }) => status === "pass"),
        checkedAt: this.now().toISOString(),
        expected,
        checks,
      };
    } catch (error) {
      return {
        ok: false,
        checkedAt: this.now().toISOString(),
        expected,
        checks: [{ name: "webRequest", status: "fail", code: failureType(error) }],
      };
    }
  }
}
