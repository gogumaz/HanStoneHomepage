import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const distDirectory = fileURLToPath(new URL("../dist", import.meta.url));

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );

  return files.flat();
}

const [root, oauth, payments, files] = await Promise.all([
  import("@baduk-history/integration-components"),
  import("@baduk-history/integration-components/oauth"),
  import("@baduk-history/integration-components/payments"),
  listFiles(distDirectory),
]);

assert.equal(root.OAuthClient, oauth.OAuthClient);
assert.equal(root.PaymentComponentModule, payments.PaymentComponentModule);
assert.equal(typeof oauth.OAuthComponentModule.register, "function");
assert.equal(typeof oauth.GoogleOAuthProvider, "function");
assert.equal(typeof payments.PortOneV1PaymentProvider, "function");
assert.equal(typeof payments.PAYMENT_PROVIDER, "symbol");
assert.ok(files.some((file) => file.endsWith("/index.js")));
assert.ok(files.some((file) => file.endsWith("/index.d.ts")));
assert.ok(files.every((file) => !file.includes(".test.")));

console.log(`Package exports verified (${files.length} build artifacts).`);
