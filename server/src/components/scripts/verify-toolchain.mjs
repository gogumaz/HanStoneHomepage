import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version: typescriptVersion } = require("typescript/package.json");
const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);
const typescriptMajor = Number.parseInt(typescriptVersion.split(".")[0] ?? "", 10);

assert.ok(Number.isInteger(nodeMajor) && nodeMajor >= 26, `Node.js 26+ is required; found ${process.versions.node}`);
assert.equal(typescriptMajor, 7, `TypeScript 7 is required; found ${typescriptVersion}`);

console.log(`Toolchain verified (Node.js ${process.versions.node}, TypeScript ${typescriptVersion}).`);
