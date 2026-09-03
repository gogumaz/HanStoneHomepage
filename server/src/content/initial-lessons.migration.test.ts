import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDirectory = fileURLToPath(new URL("../../prisma/migrations/", import.meta.url));

function readAllMigrationSql(): string {
  return readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${migrationsDirectory}/${entry.name}/migration.sql`)
    .sort()
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

describe("initial lesson migration data", () => {
  it("seeds only PRE-01 as the published prehistoric free sample", () => {
    const sql = readAllMigrationSql();
    const lessonInserts = [...sql.matchAll(
      /INSERT\s+INTO\s+"Lesson"\s*\([\s\S]*?\)\s*VALUES\s*([\s\S]*?);/gi,
    )];

    expect(lessonInserts).toHaveLength(1);
    const values = lessonInserts[0]?.[1]?.trim() ?? "";
    const insertedRows = [...values.matchAll(/(?:^|,)\s*\(\s*'/g)];

    expect(insertedRows).toHaveLength(1);
    expect(values).toMatch(/^\(\s*'PRE-01'\s*,\s*'era_prehistoric'\s*,\s*1\s*,/);
    expect(values).toMatch(/,\s*'PUBLISHED'\s*,\s*true\s*,/);
  });
});
