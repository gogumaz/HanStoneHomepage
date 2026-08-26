import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { WebDeploymentVerificationService } from "./web-deployment-verification.service.js";

const commitSha = "a".repeat(40);
const indexBytes = new TextEncoder().encode("<!doctype html><title>Baduk</title>");
const assetBytes = new TextEncoder().encode("console.log('baduk');");
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");

function fixture() {
  const manifest = {
    schemaVersion: 1,
    ok: true,
    commitSha,
    generatedAt: "2026-08-25T00:00:00.000Z",
    files: [
      {
        path: "index.html", sha256: hash(indexBytes), bytes: indexBytes.byteLength,
        contentType: "text/html; charset=utf-8", cacheControl: "public,max-age=0,must-revalidate",
      },
      {
        path: "assets/index-AbCdEf12.js", sha256: hash(assetBytes), bytes: assetBytes.byteLength,
        contentType: "text/javascript; charset=utf-8", cacheControl: "public,max-age=31536000,immutable",
      },
    ],
    totals: { files: 2, bytes: indexBytes.byteLength + assetBytes.byteLength },
  };
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, manifestBytes, manifestSha256: hash(manifestBytes) };
}

function response(body: Uint8Array, contentType: string, cacheControl: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType, "cache-control": cacheControl } });
}

describe("WebDeploymentVerificationService", () => {
  it("binds the live manifest, index, immutable asset, and CDN cache headers to accepted evidence", async () => {
    const { manifestBytes, manifestSha256 } = fixture();
    const fetcher = vi.fn(async (input: string | URL) => {
      const path = new URL(input).pathname;
      if (path === "/web-deployment-manifest.json") {
        return response(manifestBytes, "application/json; charset=utf-8", "public, max-age=0, must-revalidate");
      }
      if (path === "/index.html") {
        return response(indexBytes, "text/html; charset=utf-8", "public, max-age=0, must-revalidate");
      }
      return response(assetBytes, "text/javascript; charset=utf-8", "public, max-age=31536000, immutable");
    });
    const report = await new WebDeploymentVerificationService(
      fetcher,
      () => new Date("2026-08-25T00:10:00.000Z"),
    ).run({
      baseUrl: "https://www.example.com",
      expectedCommitSha: commitSha,
      expectedManifestSha256: manifestSha256,
      requestTimeoutMs: 1_000,
    });

    expect(report.ok).toBe(true);
    expect(report.checks.every(({ status }) => status === "pass")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(report)).not.toContain("example.com");
  });

  it("fails closed when the live manifest differs from accepted evidence", async () => {
    const { manifestBytes } = fixture();
    const report = await new WebDeploymentVerificationService(async () => response(
      manifestBytes, "application/json", "public,max-age=0,must-revalidate",
    )).run({
      baseUrl: "https://www.example.com",
      expectedCommitSha: commitSha,
      expectedManifestSha256: "1".repeat(64),
      requestTimeoutMs: 1_000,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual({
      name: "manifestSha256", status: "fail", code: "WEB_DEPLOYMENT_MANIFEST_MISMATCH",
    });
  });

  it("rejects incorrect immutable caching and sanitizes network failures", async () => {
    const { manifest, manifestBytes, manifestSha256 } = fixture();
    const wrongCacheFetcher = async (input: string | URL) => {
      const path = new URL(input).pathname;
      if (path === "/web-deployment-manifest.json") {
        return response(manifestBytes, "application/json", "public,max-age=0,must-revalidate");
      }
      if (path === "/index.html") return response(indexBytes, "text/html", "public,max-age=0,must-revalidate");
      return response(assetBytes, "text/javascript", "public,max-age=0,must-revalidate");
    };
    const config = {
      baseUrl: "https://www.example.com",
      expectedCommitSha: commitSha,
      expectedManifestSha256: manifestSha256,
      requestTimeoutMs: 1_000,
    };
    const cacheReport = await new WebDeploymentVerificationService(wrongCacheFetcher).run(config);
    expect(cacheReport.checks).toContainEqual({
      name: "assetCacheControl", status: "fail", code: "WEB_DEPLOYMENT_ASSET_CACHE_POLICY_INVALID",
    });

    const error = new Error("https://private.example.com/token");
    error.name = "FETCH_FAILED";
    const networkReport = await new WebDeploymentVerificationService(async () => { throw error; }).run(config);
    expect(networkReport.checks).toEqual([{ name: "webRequest", status: "fail", code: "FETCH_FAILED" }]);
    expect(JSON.stringify(networkReport)).not.toContain("private.example.com");
  });

  it("rejects malformed immutable identities and timeout bounds", async () => {
    const service = new WebDeploymentVerificationService();
    await expect(service.run({
      baseUrl: "https://www.example.com", expectedCommitSha: "main", expectedManifestSha256: "1".repeat(64),
      requestTimeoutMs: 1_000,
    })).rejects.toMatchObject({ name: "WEB_DEPLOYMENT_COMMIT_SHA_INVALID" });
    await expect(service.run({
      baseUrl: "https://www.example.com", expectedCommitSha: commitSha, expectedManifestSha256: "latest",
      requestTimeoutMs: 1_000,
    })).rejects.toMatchObject({ name: "WEB_DEPLOYMENT_MANIFEST_SHA256_INVALID" });
    await expect(service.run({
      baseUrl: "http://www.example.com", expectedCommitSha: commitSha,
      expectedManifestSha256: "1".repeat(64), requestTimeoutMs: 1_000,
    })).rejects.toMatchObject({ name: "DEPLOY_VERIFY_BASE_URL_INVALID" });
  });
});
