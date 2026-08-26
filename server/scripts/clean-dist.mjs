import { rm } from "node:fs/promises";
import { dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptsDirectory, "..");
const outputDirectory = resolve(projectDirectory, "dist");

if (dirname(outputDirectory) !== projectDirectory || basename(outputDirectory) !== "dist") {
  throw new Error("BUILD_OUTPUT_PATH_INVALID");
}

await rm(outputDirectory, { recursive: true, force: true });
