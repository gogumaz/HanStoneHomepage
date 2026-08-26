import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function runtimeTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "generated" || entry.name === "dist") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return runtimeTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });
}

describe("SQL query safety policy", () => {
  it("does not allow unsafe Prisma raw-query APIs in runtime source", () => {
    const unsafeApis = [
      ["$query", "RawUnsafe"].join(""),
      ["$execute", "RawUnsafe"].join(""),
    ];
    const offenders = runtimeTypeScriptFiles(resolve(process.cwd(), "src"))
      .filter((path) => unsafeApis.some((api) => readFileSync(path, "utf8").includes(api)))
      .map((path) => path.replace(`${process.cwd()}\\`, ""));

    expect(offenders).toEqual([]);
  });
});
