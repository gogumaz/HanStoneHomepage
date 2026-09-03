import { defineConfig, devices } from "@playwright/test";

const e2ePort = Number.parseInt(process.env.E2E_PORT ?? "4173", 10);
if (!Number.isInteger(e2ePort) || e2ePort < 1024 || e2ePort > 65535) {
  throw new Error("E2E_PORT must be an integer between 1024 and 65535.");
}
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: /performance-validation\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [
    ["github"],
    ["./e2e/field-evidence-reporter.ts", { outputFile: "test-results/field-validation-report.json" }],
  ] : "list",
  use: {
    baseURL: e2eBaseUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "field-firefox",
      testMatch: /field-validation\.spec\.ts/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "field-mobile-chrome",
      testMatch: /field-validation\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "field-mobile-safari",
      testMatch: /field-validation\.spec\.ts/,
      use: { ...devices["iPhone 14"] },
    },
  ],
  webServer: {
    command: `npm run dev:web -- --port ${e2ePort} --strictPort`,
    url: `${e2eBaseUrl}/app.html`,
    reuseExistingServer: !process.env.CI,
  },
});
