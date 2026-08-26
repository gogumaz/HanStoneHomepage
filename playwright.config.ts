import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [
    ["github"],
    ["./e2e/field-evidence-reporter.ts", { outputFile: "test-results/field-validation-report.json" }],
  ] : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
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
    command: "npm run dev:web",
    url: "http://127.0.0.1:5173/app.html",
    reuseExistingServer: !process.env.CI,
  },
});
