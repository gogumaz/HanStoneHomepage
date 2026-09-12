import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production Toss deployment contract", () => {
  it("requires a live payment-widget secret instead of an optional key", async () => {
    const compose = await readFile(resolve(process.cwd(), "../deploy/compose.production.yaml"), "utf8");
    const environment = await readFile(resolve(process.cwd(), "../deploy/production.env.example"), "utf8");

    expect(compose).toContain(
      "TOSS_PAYMENTS_SECRET_KEY: ${TOSS_PAYMENTS_SECRET_KEY:?TOSS_PAYMENTS_SECRET_KEY must be set to a live_gsk_ key}",
    );
    expect(compose).not.toContain("TOSS_PAYMENTS_SECRET_KEY: ${TOSS_PAYMENTS_SECRET_KEY:-}");
    expect(environment).toContain("TOSS_PAYMENTS_SECRET_KEY=live_gsk_");
  });
});
