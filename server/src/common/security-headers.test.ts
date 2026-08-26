import { createServer, type Server } from "node:http";
import helmet from "helmet";
import { afterEach, describe, expect, it } from "vitest";
import { apiSecurityHeaders } from "./security-headers.js";

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    if (!server) return resolve();
    server.close((error) => error ? reject(error) : resolve());
  });
  server = undefined;
});

async function securityResponse(nodeEnv: "test" | "production"): Promise<Response> {
  const middleware = helmet(apiSecurityHeaders(nodeEnv));
  server = createServer((request, response) => {
    middleware(request as never, response as never, () => {
      response.statusCode = 204;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server address unavailable");
  return fetch(`http://127.0.0.1:${address.port}/health`);
}

describe("API security headers", () => {
  it("denies executable document sources and framing on API responses", async () => {
    const response = await securityResponse("test");
    const csp = response.headers.get("content-security-policy") ?? "";

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("strict-transport-security")).toBeNull();
  });

  it("enables one-year HSTS only for production", async () => {
    const response = await securityResponse("production");

    expect(response.headers.get("strict-transport-security"))
      .toBe("max-age=31536000; includeSubDomains");
    expect(response.headers.get("content-security-policy"))
      .toContain("upgrade-insecure-requests");
  });
});
