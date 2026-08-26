import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../database/prisma.service.js";
import { WorkerHealthService } from "./worker-health.service.js";

function queue(counts: [number, number, number] = [0, 0, 0], oldestDueAt: Date | null = null) {
  return {
    count: vi.fn()
      .mockResolvedValueOnce(counts[0])
      .mockResolvedValueOnce(counts[1])
      .mockResolvedValueOnce(counts[2]),
    findFirst: vi.fn(async () => oldestDueAt ? { nextAttemptAt: oldestDueAt } : null),
  };
}

function createService(input: {
  accountMail?: [number, number, number];
  accountOldest?: Date;
  inquiry?: [number, number, number];
  video?: [number, number, number];
  hls?: [number, number, number];
  deletion?: [number, number, number];
} = {}) {
  const prisma = {
    accountMailJob: queue(input.accountMail, input.accountOldest),
    inquiryNotificationJob: queue(input.inquiry),
    lessonVideoAsset: queue(input.video),
    hlsTranscodeJob: queue(input.hls),
    objectDeletionJob: queue(input.deletion),
  };
  return { service: new WorkerHealthService(prisma as unknown as PrismaService), prisma };
}

describe("WorkerHealthService", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
    process.env.WORKER_HEALTH_BACKLOG_MINUTES = "15";
  });

  it("reports healthy when every durable queue is current", async () => {
    const report = await createService().service.inspect(new Date("2026-08-24T00:30:00.000Z"));
    expect(report).toMatchObject({ status: "healthy", backlogThresholdMinutes: 15 });
    expect(report.queues).toHaveLength(5);
    expect(report.queues.every((item) => item.status === "healthy")).toBe(true);
  });

  it("reports attention for a terminal failure without exposing job data", async () => {
    const report = await createService({ inquiry: [0, 0, 2] }).service
      .inspect(new Date("2026-08-24T00:30:00.000Z"));
    expect(report.status).toBe("attention");
    expect(report.queues.find((item) => item.name === "inquiryNotification")).toMatchObject({
      status: "attention",
      terminalErrors: 2,
    });
    expect(Object.keys(report.queues[0] ?? {})).toEqual([
      "name", "status", "due", "staleLocks", "terminalErrors", "oldestDueAt",
    ]);
  });

  it("reports critical when a due job exceeds the backlog threshold", async () => {
    const report = await createService({
      accountMail: [1, 0, 0],
      accountOldest: new Date("2026-08-24T00:10:00.000Z"),
    }).service.inspect(new Date("2026-08-24T00:30:00.000Z"));
    expect(report.status).toBe("critical");
    expect(report.queues.find((item) => item.name === "accountMail")).toMatchObject({
      status: "critical",
      due: 1,
      oldestDueAt: "2026-08-24T00:10:00.000Z",
    });
  });

  it("reports critical for a stale worker lock", async () => {
    const report = await createService({ hls: [0, 1, 0] }).service
      .inspect(new Date("2026-08-24T00:30:00.000Z"));
    expect(report.queues.find((item) => item.name === "hlsTranscode")).toMatchObject({
      status: "critical",
      staleLocks: 1,
    });
  });
});
