import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { ApiResponseInterceptor } from "../common/api-response.interceptor.js";
import { RequestIdMiddleware } from "../common/request-id.middleware.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  AccountStatus,
  BadukMissionStatus,
  MissionAttemptStatus,
  RewardType,
  RoleType,
} from "../generated/prisma/enums.js";
import { hashSessionToken } from "../auth/session-cookie.js";

const now = new Date();

function sampleMission(overrides: Record<string, any> = {}) {
  return {
    id: "MISSION-HTTP-9",
    version: 1,
    title: "마지막 활로",
    instruction: "백돌을 잡아 보세요.",
    status: BadukMissionStatus.PUBLISHED,
    level: "입문",
    volume: 1,
    lessonNumber: 1,
    problemGroup: "개념 확인",
    category: "따내기",
    difficulty: 1,
    displayOrder: 1,
    eraId: null,
    lessonId: null,
    textbookPage: null,
    boardSize: 9,
    ruleset: "japanese_simple_ko",
    playerColor: "black",
    initialBlackStones: [{ x: 3, y: 4 }, { x: 4, y: 3 }, { x: 5, y: 4 }],
    initialWhiteStones: [{ x: 4, y: 4 }],
    missionType: "capture",
    successCondition: null,
    solutionTree: {
      rootNodeId: "root",
      nodes: {
        root: { actor: "player", acceptedMoves: [{ x: 4, y: 5, result: "correct", nextNodeId: "done" }] },
        done: { terminal: "success" },
      },
    },
    hints: ["활로를 세어 보세요.", { x: 4, y: 5 }],
    correctExplanation: "마지막 활로를 막았습니다.",
    feedbacks: { incorrect: "다시 활로를 찾아보세요." },
    baseScore: 100,
    timeLimitSeconds: null,
    retryLimit: 3,
    isFreeSample: true,
    rewardId: "mission-star",
    rewardQuantity: 1,
    scheduledAt: null,
    publishedAt: now,
    createdById: null,
    updatedById: null,
    publishedById: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function isPublicAt(mission: Record<string, any>, at: Date) {
  return mission.status === BadukMissionStatus.PUBLISHED
    || (mission.status === BadukMissionStatus.SCHEDULED
      && mission.scheduledAt instanceof Date
      && mission.scheduledAt.getTime() <= at.getTime());
}

function matchesSearch(mission: Record<string, any>, conditions: Array<Record<string, any>> | undefined) {
  if (!conditions) return true;
  return conditions.some((condition) => Object.entries(condition).some(([field, filter]) =>
    String(mission[field] ?? "").toLowerCase().includes(String(filter.contains ?? "").toLowerCase())));
}

function createPrismaMock() {
  const users = [
    {
      id: "00000000-0000-0000-0000-000000000101",
      email: "student@mission.test",
      displayName: "미션 학생",
      passwordHash: null,
      emailVerifiedAt: now,
      status: AccountStatus.ACTIVE,
      roles: [{ role: RoleType.STUDENT }],
    },
    {
      id: "00000000-0000-0000-0000-000000000102",
      email: "operator@mission.test",
      displayName: "미션 운영자",
      passwordHash: null,
      emailVerifiedAt: now,
      status: AccountStatus.ACTIVE,
      roles: [{ role: RoleType.OPERATOR }],
    },
  ];
  const sessions = [
    { id: "session-student", userId: users[0]?.id, tokenHash: hashSessionToken("mission-student-token"), expiresAt: new Date(Date.now() + 60_000), revokedAt: null },
    { id: "session-operator", userId: users[1]?.id, tokenHash: hashSessionToken("mission-operator-token"), expiresAt: new Date(Date.now() + 60_000), revokedAt: null },
  ];
  const missions: Array<Record<string, any>> = [sampleMission()];
  const attempts: Array<Record<string, any>> = [];
  const moves: Array<Record<string, any>> = [];
  const rewards = [{
    id: "mission-star", type: RewardType.STAR, title: "미션 별",
    description: "바둑미션 완료 보상", active: true, createdAt: now, updatedAt: now,
  }];
  const rewardGrants: Array<Record<string, any>> = [];
  const favorites: Array<Record<string, any>> = [];
  const prisma = {
    session: {
      findUnique: vi.fn(async ({ where, include }: { where: { tokenHash: string }; include?: unknown }) => {
        const session = sessions.find((item) => item.tokenHash === where.tokenHash);
        if (!session) return null;
        return include ? { ...session, user: users.find((item) => item.id === session.userId) } : session;
      }),
    },
    badukMission: {
      findMany: vi.fn(async ({ where }: { where?: Record<string, any> }) => missions.filter((mission) =>
        (!where?.status || mission.status === where.status)
        && (!where?.AND || isPublicAt(mission, new Date()))
        && matchesSearch(mission, where?.OR)
        && (!where?.boardSize || mission.boardSize === where.boardSize)
        && (!where?.level || mission.level === where.level)
        && (!where?.volume || mission.volume === where.volume)
        && (!where?.lessonNumber || mission.lessonNumber === where.lessonNumber)
        && (!where?.category || mission.category === where.category)
        && (!where?.problemGroup || mission.problemGroup === where.problemGroup)
        && (!where?.missionType || mission.missionType === where.missionType)
        && (!where?.lessonId || mission.lessonId === where.lessonId)
        && (!where?.difficulty || mission.difficulty === where.difficulty))),
      findFirst: vi.fn(async ({ where }: { where: Record<string, any> }) => missions.find((mission) =>
        mission.id === where.id && (!where.status || mission.status === where.status)
        && (!where.AND || isPublicAt(mission, new Date()))) ?? null),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => missions.find((mission) => mission.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        const mission = sampleMission({
          ...data,
          version: 1,
          status: BadukMissionStatus.DRAFT,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        missions.push(mission);
        return mission;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
        const mission = missions.find((item) => item.id === where.id);
        if (!mission) throw new Error("missing mission");
        for (const [key, value] of Object.entries(data)) {
          mission[key] = value && typeof value === "object" && "increment" in value
            ? mission[key] + value.increment
            : value;
        }
        mission.updatedAt = new Date();
        return mission;
      }),
    },
    missionAttempt: {
      findMany: vi.fn(async ({ where }: { where: Record<string, any> }) => attempts.filter((attempt) =>
        (!where.userId || attempt.userId === where.userId)
        && (!where.missionId || typeof where.missionId !== "string" || attempt.missionId === where.missionId)
        && (!where.missionId?.in || where.missionId.in.includes(attempt.missionId))
        && (!where.status || attempt.status === where.status)
        && (!where.wrongMoveCount?.gt || attempt.wrongMoveCount > where.wrongMoveCount.gt))
        .map((attempt) => ({
          ...attempt,
          mission: missions.find((item) => item.id === attempt.missionId),
          moves: moves.filter((move) => move.attemptId === attempt.id),
        }))),
      findFirst: vi.fn(async ({ where }: { where: Record<string, any> }) => attempts.find((attempt) =>
        attempt.missionId === where.missionId && attempt.userId === where.userId && attempt.status === where.status) ?? null),
      findUnique: vi.fn(async ({ where, include }: { where: Record<string, any>; include?: unknown }) => {
        const attempt = where.id
          ? attempts.find((item) => item.id === where.id)
          : attempts.find((item) => item.clientAttemptId === where.clientAttemptId);
        if (!attempt) return null;
        return include ? {
          ...attempt,
          mission: missions.find((item) => item.id === attempt.missionId),
          moves: moves.filter((item) => item.attemptId === attempt.id),
        } : attempt;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        const attempt = {
          id: `00000000-0000-4000-8000-${String(attempts.length + 1).padStart(12, "0")}`,
          ...data,
          status: MissionAttemptStatus.IN_PROGRESS,
          moveCount: 0,
          wrongMoveCount: 0,
          attemptCount: 0,
          hintLevel: 0,
          hintUseCount: 0,
          score: 0,
          startedAt: new Date(),
          lastPlayedAt: new Date(),
          completedAt: null,
        };
        attempts.push(attempt);
        return attempt;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
        const attempt = attempts.find((item) => item.id === where.id && item.status === where.status
          && item.boardHash === where.boardHash && item.moveCount === where.moveCount);
        if (!attempt) return { count: 0 };
        Object.assign(attempt, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
        const attempt = attempts.find((item) => item.id === where.id);
        if (!attempt) throw new Error("missing attempt");
        for (const [key, value] of Object.entries(data)) {
          attempt[key] = value && typeof value === "object" && "increment" in value
            ? attempt[key] + value.increment
            : value;
        }
        return attempt;
      }),
    },
    missionMove: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, any> }) => {
        const key = where.attemptId_clientMoveId;
        return moves.find((move) => move.attemptId === key.attemptId && move.clientMoveId === key.clientMoveId) ?? null;
      }),
      count: vi.fn(async ({ where }: { where: { attemptId: string } }) => moves.filter((move) => move.attemptId === where.attemptId).length),
      create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        const move = { id: `move-${moves.length + 1}`, ...data, playedAt: new Date() };
        moves.push(move);
        return move;
      }),
    },
    reward: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rewards.find((reward) =>
        reward.id === where.id) ?? null),
    },
    rewardGrant: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, any>> }) => {
        const input = data[0];
        if (!input || rewardGrants.some((grant) => grant.attemptId === input.attemptId
          || (grant.userId === input.userId && grant.missionId === input.missionId))) return { count: 0 };
        rewardGrants.push({ id: `reward-grant-${rewardGrants.length + 1}`, ...input, grantedAt: new Date() });
        return { count: 1 };
      }),
      findMany: vi.fn(async ({ where }: { where: { userId: string } }) => rewardGrants
        .filter((grant) => grant.userId === where.userId)
        .map((grant) => ({ ...grant, mission: missions.find((mission) => mission.id === grant.missionId) }))),
    },
    missionFavorite: {
      findMany: vi.fn(async ({ where }: { where: Record<string, any> }) => favorites.filter((favorite) =>
        favorite.userId === where.userId && (!where.missionId?.in || where.missionId.in.includes(favorite.missionId)))),
      findUnique: vi.fn(async ({ where }: { where: Record<string, any> }) => {
        const key = where.userId_missionId;
        return favorites.find((favorite) => favorite.userId === key.userId && favorite.missionId === key.missionId) ?? null;
      }),
      upsert: vi.fn(async ({ where, create }: { where: Record<string, any>; create: Record<string, any> }) => {
        const key = where.userId_missionId;
        const existing = favorites.find((favorite) => favorite.userId === key.userId && favorite.missionId === key.missionId);
        if (existing) return existing;
        const favorite = { id: `favorite-${favorites.length + 1}`, ...create, createdAt: new Date() };
        favorites.push(favorite);
        return favorite;
      }),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, any> }) => {
        const before = favorites.length;
        for (let index = favorites.length - 1; index >= 0; index -= 1) {
          if (favorites[index]?.userId === where.userId && favorites[index]?.missionId === where.missionId) favorites.splice(index, 1);
        }
        return { count: before - favorites.length };
      }),
    },
    accountSubscription: { findFirst: vi.fn(async () => null) },
    auditLog: { create: vi.fn(async () => ({ id: "audit" })) },
    isReady: vi.fn(async () => true),
    $transaction: vi.fn(async (input: unknown) => typeof input === "function"
      ? (input as (transaction: typeof prisma) => unknown)(prisma)
      : Promise.all(input as Promise<unknown>[])),
  };
  return { prisma: prisma as unknown as PrismaService, missions, attempts, moves, rewardGrants, favorites };
}

describe("baduk mission HTTP flow", () => {
  let app: INestApplication;
  let baseUrl: string;
  const state = createPrismaMock();

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    process.env.SESSION_COOKIE_NAME = "baduk_session";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(state.prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    const requestId = new RequestIdMiddleware();
    app.use(requestId.use.bind(requestId));
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => app.close());

  it("passes SQL injection text to Prisma only as a structured search value", async () => {
    const injection = `' OR 1=1; DROP TABLE "BadukMission"; --`;
    const response = await fetch(`${baseUrl}/api/v1/missions?q=${encodeURIComponent(injection)}`);

    expect(response.status).toBe(200);
    expect((await response.json() as { data: { items: unknown[] } }).data.items).toEqual([]);
    expect(vi.mocked(state.prisma.badukMission.findMany)).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { title: { contains: injection, mode: "insensitive" } },
        ]),
      }),
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    });
  });

  it("lists 9-line missions without exposing the solution tree and completes a capture idempotently", async () => {
    const listResponse = await fetch(`${baseUrl}/api/v1/missions?boardSize=9`);
    const list = await listResponse.json() as { data: { items: Array<Record<string, unknown>> } };
    expect(listResponse.status).toBe(200);
    expect(list.data.items).toHaveLength(1);
    expect(list.data.items[0]).not.toHaveProperty("solutionTree");

    const startResponse = await fetch(`${baseUrl}/api/v1/missions/MISSION-HTTP-9/attempts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "free_trial", clientAttemptId: "attempt_http_001" }),
    });
    const start = await startResponse.json() as { data: { attempt: Record<string, any> } };
    expect(startResponse.status).toBe(201);
    expect(start.data.attempt.boardState.stones).toHaveLength(4);

    const moveBody = {
      clientMoveId: "move_http_001",
      missionVersion: 1,
      expectedMoveNumber: 0,
      boardHash: start.data.attempt.boardHash,
      move: { x: 4, y: 5 },
    };
    const moveResponse = await fetch(`${baseUrl}/api/v1/mission-attempts/${start.data.attempt.id}/moves`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(moveBody),
    });
    const result = await moveResponse.json() as { data: Record<string, any> };
    expect(result.data).toMatchObject({ result: "correct", status: "completed", score: 100 });
    expect(result.data.playerMove.capturedStones).toEqual([{ x: 4, y: 4 }]);
    expect(result.data.boardState.captures).toEqual({ black: 1, white: 0 });

    const duplicateResponse = await fetch(`${baseUrl}/api/v1/mission-attempts/${start.data.attempt.id}/moves`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(moveBody),
    });
    expect(await duplicateResponse.json()).toEqual({ data: result.data });
    expect(state.moves.filter((move) => move.clientMoveId === "move_http_001")).toHaveLength(1);
  });

  it("resumes an anonymous free-mission attempt by its browser-held capability id", async () => {
    const startResponse = await fetch(`${baseUrl}/api/v1/missions/MISSION-HTTP-9/attempts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "free_trial", clientAttemptId: "attempt_resume_001" }),
    });
    const started = await startResponse.json() as { data: { attempt: Record<string, any> } };
    const attemptId = started.data.attempt.id as string;

    const resumedResponse = await fetch(`${baseUrl}/api/v1/missions/MISSION-HTTP-9?attemptId=${encodeURIComponent(attemptId)}`);
    const resumed = await resumedResponse.json() as { data: { attempt: Record<string, any> | null } };
    expect(resumedResponse.status).toBe(200);
    expect(resumed.data.attempt).toMatchObject({ id: attemptId, status: "in_progress", moveCount: 0 });

    const duplicateStart = await fetch(`${baseUrl}/api/v1/missions/MISSION-HTTP-9/attempts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "free_trial", clientAttemptId: "attempt_resume_001" }),
    });
    expect((await duplicateStart.json() as { data: { attempt: { id: string } } }).data.attempt.id).toBe(attemptId);

    const invalidResponse = await fetch(`${baseUrl}/api/v1/missions/MISSION-HTTP-9?attemptId=not-a-uuid`);
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toMatchObject({ error: { code: "MISSION_ATTEMPT_ID_INVALID" } });
  });

  it("searches detailed mission fields and toggles a learner favorite idempotently", async () => {
    const linkedMission = state.missions.find((item) => item.id === "MISSION-HTTP-9");
    if (!linkedMission) throw new Error("sample mission is missing");
    linkedMission.lessonId = "PRE-01";
    state.missions.push(sampleMission({
      id: "MISSION-HIDDEN-9",
      title: "마지막 활로 비공개 초안",
      status: BadukMissionStatus.DRAFT,
    }));
    expect((await fetch(`${baseUrl}/api/v1/me/mission-favorites/MISSION-HTTP-9`, { method: "POST" })).status).toBe(401);
    const headers = { "content-type": "application/json", cookie: "baduk_session=mission-student-token" };
    const add = await fetch(`${baseUrl}/api/v1/me/mission-favorites/MISSION-HTTP-9`, { method: "POST", headers, body: "{}" });
    expect(await add.json()).toMatchObject({ data: { missionId: "MISSION-HTTP-9", isFavorite: true } });
    await fetch(`${baseUrl}/api/v1/me/mission-favorites/MISSION-HTTP-9`, { method: "POST", headers, body: "{}" });
    expect(state.favorites).toHaveLength(1);

    const search = new URLSearchParams({ q: "마지막", missionType: "capture", boardSize: "9", lessonId: "PRE-01", favorite: "true" });
    const listResponse = await fetch(`${baseUrl}/api/v1/missions?${search}`, { headers: { cookie: headers.cookie } });
    const list = await listResponse.json() as { data: { items: Array<Record<string, any>> } };
    expect(list.data.items).toHaveLength(1);
    expect(list.data.items[0]).toMatchObject({ id: "MISSION-HTTP-9", isFavorite: true });
    expect(list.data.items.some((item) => item.id === "MISSION-HIDDEN-9")).toBe(false);

    const remove = await fetch(`${baseUrl}/api/v1/me/mission-favorites/MISSION-HTTP-9`, { method: "DELETE", headers });
    expect(await remove.json()).toMatchObject({ data: { isFavorite: false } });
    expect(state.favorites).toHaveLength(0);
    linkedMission.lessonId = null;
    state.missions.splice(state.missions.findIndex((item) => item.id === "MISSION-HIDDEN-9"), 1);
  });

  it("ends an expired attempt on the server and keeps the timeout response idempotent", async () => {
    const mission = state.missions.find((item) => item.id === "MISSION-HTTP-9");
    if (!mission) throw new Error("sample mission is missing");
    mission.timeLimitSeconds = 1;

    const startResponse = await fetch(`${baseUrl}/api/v1/missions/MISSION-HTTP-9/attempts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "free_trial", clientAttemptId: "attempt_timeout_001" }),
    });
    const start = await startResponse.json() as { data: { attempt: Record<string, any> } };
    const attempt = state.attempts.find((item) => item.id === start.data.attempt.id);
    if (!attempt) throw new Error("timeout attempt is missing");
    attempt.startedAt = new Date(Date.now() - 2_000);

    const moveBody = {
      clientMoveId: "move_timeout_001",
      missionVersion: 1,
      expectedMoveNumber: 0,
      boardHash: start.data.attempt.boardHash,
      move: { x: 4, y: 5 },
    };
    const moveResponse = await fetch(`${baseUrl}/api/v1/mission-attempts/${start.data.attempt.id}/moves`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(moveBody),
    });
    const result = await moveResponse.json() as { data: Record<string, any> };
    expect(result.data).toMatchObject({ result: "timeout", reason: "time_limit", status: "failed", moveCount: 0 });

    const duplicateResponse = await fetch(`${baseUrl}/api/v1/mission-attempts/${start.data.attempt.id}/moves`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(moveBody),
    });
    expect(await duplicateResponse.json()).toEqual({ data: result.data });
    mission.timeLimitSeconds = null;
  });

  it("grants a logged-in learner's mission reward only once across retries", async () => {
    const headers = { "content-type": "application/json", cookie: "baduk_session=mission-student-token" };
    const startResponse = await fetch(`${baseUrl}/api/v1/missions/MISSION-HTTP-9/attempts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ source: "mission_list", clientAttemptId: "attempt_reward_001" }),
    });
    const started = await startResponse.json() as { data: { attempt: Record<string, any> } };

    const complete = async (clientMoveId: string, boardHash: string) => {
      const response = await fetch(`${baseUrl}/api/v1/mission-attempts/${started.data.attempt.id}/moves`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          clientMoveId,
          missionVersion: 1,
          expectedMoveNumber: 0,
          boardHash,
          move: { x: 4, y: 5 },
        }),
      });
      return response.json() as Promise<{ data: Record<string, any> }>;
    };

    const first = await complete("move_reward_001", started.data.attempt.boardHash);
    expect(first.data.reward).toMatchObject({ id: "mission-star", type: "star", quantity: 1, newlyGranted: true });
    expect(state.rewardGrants).toHaveLength(1);

    const retryResponse = await fetch(`${baseUrl}/api/v1/mission-attempts/${started.data.attempt.id}/retry`, {
      method: "POST",
      headers,
    });
    const retried = await retryResponse.json() as { data: { attempt: Record<string, any> } };
    const second = await complete("move_reward_002", retried.data.attempt.boardHash);
    expect(second.data.reward).toMatchObject({ id: "mission-star", quantity: 1, newlyGranted: false });
    expect(state.rewardGrants).toHaveLength(1);

    const rewardsResponse = await fetch(`${baseUrl}/api/v1/me/rewards`, { headers: { cookie: headers.cookie } });
    const rewards = await rewardsResponse.json() as { data: Record<string, any> };
    expect(rewards.data).toMatchObject({ totals: { stars: 1, badges: 0, artifactCards: 0 } });
    expect(rewards.data.items).toHaveLength(1);
  });

  it("protects the problem CMS and lets an operator create, validate, and publish a 13-line mission", async () => {
    expect((await fetch(`${baseUrl}/api/v1/admin/missions`)).status).toBe(401);
    const body = {
      id: "MISSION-HTTP-13",
      title: "13줄 중심 찾기",
      instruction: "13줄 판의 중심에 두세요.",
      level: "기초",
      volume: 1,
      lessonNumber: 1,
      problemGroup: "개념 확인",
      category: "포석",
      difficulty: 1,
      displayOrder: 2,
      boardSize: 13,
      playerColor: "black",
      initialBlackStones: [],
      initialWhiteStones: [],
      missionType: "best_move",
      solutionTree: {
        rootNodeId: "root",
        nodes: {
          root: { actor: "player", acceptedMoves: [{ x: 6, y: 6, result: "correct", nextNodeId: "done" }] },
          done: { terminal: "success" },
        },
      },
      hints: ["가운데를 찾아보세요."],
      correctExplanation: "13줄 판의 중심입니다.",
      feedbacks: { incorrect: "중앙 교차점을 세어 보세요." },
      baseScore: 100,
      isFreeSample: true,
    };
    const headers = { "content-type": "application/json", cookie: "baduk_session=mission-operator-token" };
    const createResponse = await fetch(`${baseUrl}/api/v1/admin/missions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(createResponse.status).toBe(201);

    const invalidUpdate = await fetch(`${baseUrl}/api/v1/admin/missions/MISSION-HTTP-13`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title: "" }),
    });
    expect(invalidUpdate.status).toBe(400);

    const attemptsBeforePreview = state.attempts.length;
    const previewResponse = await fetch(`${baseUrl}/api/v1/admin/missions/MISSION-HTTP-13/preview`, {
      method: "POST",
      headers,
      body: JSON.stringify({ moves: [{ x: 6, y: 6 }] }),
    });
    const preview = await previewResponse.json() as { data: { preview: Record<string, any> } };
    expect(preview.data.preview).toMatchObject({ status: "completed", persisted: false, moveCount: 1, score: 100 });
    expect(state.attempts).toHaveLength(attemptsBeforePreview);

    const statisticsResponse = await fetch(`${baseUrl}/api/v1/admin/missions/MISSION-HTTP-13/statistics`, { headers });
    const statistics = await statisticsResponse.json() as { data: { summary: Record<string, any> } };
    expect(statistics.data.summary).toMatchObject({ totalAttempts: 0, completionRate: 0, submittedMoves: 0 });

    const validateResponse = await fetch(`${baseUrl}/api/v1/admin/missions/MISSION-HTTP-13/validate`, {
      method: "POST",
      headers,
    });
    expect(await validateResponse.json()).toMatchObject({ data: { valid: true, errors: [] } });

    const publishResponse = await fetch(`${baseUrl}/api/v1/admin/missions/MISSION-HTTP-13/publish`, {
      method: "POST",
      headers,
      body: "{}",
    });
    const published = await publishResponse.json() as { data: { mission: { status: string } } };
    expect(published.data.mission.status).toBe("published");
  });
});
