import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  type?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface PackageLock {
  packages: Record<string, PackageManifest & { version?: string }>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

describe("NestJS runtime alignment", () => {
  it("keeps the API and reusable components on one NestJS 12 major", () => {
    const apiPackage = readJson<PackageManifest>(resolve(process.cwd(), "package.json"));
    const apiLock = readJson<PackageLock>(resolve(process.cwd(), "package-lock.json"));
    const componentDirectory = resolve(process.cwd(), "src/components");
    const componentPackage = readJson<PackageManifest>(resolve(componentDirectory, "package.json"));
    const componentLock = readJson<PackageLock>(resolve(componentDirectory, "package-lock.json"));

    expect(apiPackage.type).toBe("module");
    expect(apiPackage.dependencies?.["@nestjs/common"]).toBe("^12.0.1");
    expect(apiPackage.dependencies?.["@nestjs/core"]).toBe("^12.0.1");
    expect(apiPackage.dependencies?.["@nestjs/platform-express"]).toBe("^12.0.1");
    expect(apiPackage.devDependencies?.["@nestjs/testing"]).toBe("^12.0.1");
    expect(apiPackage.devDependencies?.["@nestjs/cli"]).toBe("12.0.0");
    expect(apiPackage.devDependencies?.["@nestjs/schematics"]).toBe("^12.0.1");
    expect(apiPackage.devDependencies?.typescript).toBe("^7.0.2");

    for (const packageName of ["common", "core", "platform-express", "testing"]) {
      expect(apiLock.packages[`node_modules/@nestjs/${packageName}`]?.version).toBe("12.0.1");
    }

    expect(componentPackage.peerDependencies?.["@nestjs/common"]).toBe("^12.0.1");
    expect(componentPackage.devDependencies?.["@nestjs/common"]).toBe("^12.0.1");
    expect(componentLock.packages["node_modules/@nestjs/common"]?.version).toBe("12.0.1");
  });
});
