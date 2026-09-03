import type { INestApplication } from "@nestjs/common";
import { randomInt } from "node:crypto";

const TEST_PORT_MIN = 20_000;
const TEST_PORT_MAX_EXCLUSIVE = 45_000;
const MAX_LISTEN_ATTEMPTS = 25;

export async function listenForHttpTest(app: INestApplication): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_LISTEN_ATTEMPTS; attempt += 1) {
    try {
      await app.listen(randomInt(TEST_PORT_MIN, TEST_PORT_MAX_EXCLUSIVE), "127.0.0.1");
      return await app.getUrl();
    } catch (error) {
      lastError = error;
      if (!isAddressInUse(error)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("TEST_SERVER_PORT_UNAVAILABLE");
}

function isAddressInUse(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE";
}
