import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../database/prisma.service.js";
import { HealthService } from "./health.service.js";

function createService(isReady: boolean): HealthService {
  const prisma = {
    isReady: vi.fn().mockResolvedValue(isReady),
  } as unknown as PrismaService;
  return new HealthService(prisma);
}

describe("HealthService", () => {
  it("returns a liveness response without checking the database", () => {
    expect(createService(false).liveness()).toMatchObject({
      service: "baduk-history-api",
      status: "ok",
    });
  });

  it("returns ready when the database responds", async () => {
    await expect(createService(true).readiness()).resolves.toMatchObject({
      status: "ok",
      database: "ok",
    });
  });

  it("returns service unavailable when the database does not respond", async () => {
    await expect(createService(false).readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
