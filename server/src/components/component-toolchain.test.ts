import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "..");

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("integration component toolchain", () => {
  it("installs and verifies TypeScript 7 independently from parent packages", () => {
    const componentDirectory = resolve(repositoryRoot, "server/src/components");
    const componentPackage = readJson(resolve(componentDirectory, "package.json"));
    const componentLock = readJson(resolve(componentDirectory, "package-lock.json"));
    const webPackage = readJson(resolve(repositoryRoot, "package.json"));
    const apiPackage = readJson(resolve(repositoryRoot, "server/package.json"));
    const ciWorkflow = readFileSync(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8");

    expect(componentPackage.devDependencies.typescript).toBe("^7.0.2");
    expect(componentPackage.scripts.verify).toContain("verify-toolchain.mjs");
    expect(componentPackage.scripts["verify:types"]).toContain("--ignoreConfig");
    expect(componentLock.packages[""].devDependencies.typescript).toBe("^7.0.2");
    expect(componentLock.packages["node_modules/typescript"].version).toBe("7.0.2");
    expect(webPackage.scripts["pack:components"]).toContain(
      "npm --prefix server/src/components ci --ignore-scripts",
    );
    expect(apiPackage.scripts["pack:components"]).toContain(
      "npm --prefix src/components ci --ignore-scripts",
    );
    expect(ciWorkflow).toContain("server/src/components/package-lock.json");
  });
});
