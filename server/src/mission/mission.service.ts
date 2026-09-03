import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  BadukMissionStatus,
  MissionAttemptStatus,
  MissionMoveActor,
  MissionMoveResult,
  SubscriptionPaymentStatus,
} from "../generated/prisma/enums.js";
import {
  boardHash,
  createInitialBoard,
  evaluateMove,
  isBoardSize,
  isStoneColor,
  type BoardState,
  type MissionSnapshot,
  type Point,
  type SolutionTree,
} from "./go-engine.js";

const MOVE_RESULTS = {
  correct: MissionMoveResult.CORRECT,
  acceptable: MissionMoveResult.ACCEPTABLE,
  incorrect: MissionMoveResult.INCORRECT,
  forbidden: MissionMoveResult.FORBIDDEN,
  illegal: MissionMoveResult.ILLEGAL,
} as const;

@Injectable()
export class MissionService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: Record<string, unknown>, user?: CurrentUser) {
    const boardSize = optionalInteger(query.boardSize);
    if (boardSize !== undefined && !isBoardSize(boardSize)) {
      throw new ApiError("MISSION_FILTER_INVALID", "판 크기는 9, 13, 19 중 하나여야 합니다.", HttpStatus.BAD_REQUEST);
    }
    const volume = optionalInteger(query.volume);
    const lessonNumber = optionalInteger(query.lessonNumber);
    const difficulty = optionalInteger(query.difficulty);
    const level = readString(query.level);
    const category = readString(query.category);
    const problemGroup = readString(query.problemGroup);
    const missionType = readString(query.missionType);
    const lessonId = readString(query.lessonId);
    const search = readString(query.q);
    const progressStatus = readProgressFilter(query.progress);
    const favoritesOnly = readBooleanFilter(query.favorite);
    if (search.length > 80) {
      throw new ApiError("MISSION_SEARCH_INVALID", "검색어는 80자 이하로 입력해 주세요.", HttpStatus.BAD_REQUEST);
    }
    if (lessonId.length > 40) {
      throw new ApiError("MISSION_FILTER_INVALID", "강의 식별자 필터를 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    if (volume !== undefined && (volume < 1 || volume > 6)
      || lessonNumber !== undefined && (lessonNumber < 1 || lessonNumber > 8)
      || difficulty !== undefined && (difficulty < 1 || difficulty > 5)) {
      throw new ApiError("MISSION_FILTER_INVALID", "권·강·난이도 필터 범위를 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    if ((progressStatus || favoritesOnly) && !user) {
      throw new ApiError("AUTH_REQUIRED", "개인별 진행 상태와 즐겨찾기는 로그인 후 조회할 수 있습니다.", HttpStatus.UNAUTHORIZED);
    }
    const where = {
      ...publicAvailabilityWhere(),
      ...(boardSize ? { boardSize } : {}),
      ...(level ? { level } : {}),
      ...(volume !== undefined ? { volume } : {}),
      ...(lessonNumber !== undefined ? { lessonNumber } : {}),
      ...(category ? { category } : {}),
      ...(problemGroup ? { problemGroup } : {}),
      ...(missionType ? { missionType } : {}),
      ...(lessonId ? { lessonId } : {}),
      ...(difficulty !== undefined ? { difficulty } : {}),
      ...(search ? { OR: [
        { title: { contains: search, mode: "insensitive" as const } },
        { instruction: { contains: search, mode: "insensitive" as const } },
        { category: { contains: search, mode: "insensitive" as const } },
        { problemGroup: { contains: search, mode: "insensitive" as const } },
      ] } : {}),
    };
    const items = await this.prisma.badukMission.findMany({
      where,
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    });
    const progress = user ? await this.prisma.missionAttempt.findMany({
      where: { userId: user.id, missionId: { in: items.map((item) => item.id) } },
      orderBy: { lastPlayedAt: "desc" },
    }) : [];
    const favorites = user ? await this.prisma.missionFavorite.findMany({
      where: { userId: user.id, missionId: { in: items.map((item) => item.id) } },
      select: { missionId: true },
    }) : [];
    const favoriteIds = new Set(favorites.map((favorite) => favorite.missionId));
    return {
      items: items.map((mission) => {
        const attempt = progress.find((candidate) => candidate.missionId === mission.id);
        return {
          ...publicMission(mission, true),
          isFavorite: favoriteIds.has(mission.id),
          progress: attempt ? {
            attemptId: attempt.id,
            status: attempt.status.toLowerCase(),
            score: attempt.score,
            lastPlayedAt: attempt.lastPlayedAt,
          } : null,
        };
      }).filter((mission) => {
        if (favoritesOnly && !mission.isFavorite) return false;
        if (!progressStatus) return true;
        if (progressStatus === "not_started") return mission.progress === null;
        return mission.progress?.status === progressStatus;
      }),
    };
  }

  async get(missionId: string, user?: CurrentUser, resumeAttemptValue?: string) {
    const mission = await this.requirePublishedMission(missionId);
    await this.requireAccess(mission.isFreeSample, user);
    const resumeAttemptId = validateResumeAttemptId(resumeAttemptValue);
    let attempt = resumeAttemptId ? await this.prisma.missionAttempt.findUnique({ where: { id: resumeAttemptId } }) : null;
    if (attempt && (attempt.missionId !== missionId || attempt.status !== MissionAttemptStatus.IN_PROGRESS)) attempt = null;
    if (attempt) this.assertAttemptOwner(attempt, user);
    if (!attempt && user) {
      attempt = await this.prisma.missionAttempt.findFirst({
        where: { missionId, userId: user.id, status: MissionAttemptStatus.IN_PROGRESS },
        orderBy: { lastPlayedAt: "desc" },
      });
    }
    const favorite = user
      ? await this.prisma.missionFavorite.findUnique({ where: { userId_missionId: { userId: user.id, missionId } } })
      : null;
    return {
      mission: { ...publicMission(mission, true), isFavorite: Boolean(favorite) },
      attempt: attempt ? attemptView(attempt) : null,
    };
  }

  async addFavorite(user: CurrentUser, missionId: string) {
    const mission = await this.requirePublishedMission(missionId);
    await this.requireAccess(mission.isFreeSample, user);
    await this.prisma.missionFavorite.upsert({
      where: { userId_missionId: { userId: user.id, missionId } },
      create: { userId: user.id, missionId },
      update: {},
    });
    return { missionId, isFavorite: true };
  }

  async removeFavorite(user: CurrentUser, missionId: string) {
    await this.prisma.missionFavorite.deleteMany({ where: { userId: user.id, missionId } });
    return { missionId, isFavorite: false };
  }

  async startAttempt(missionId: string, body: unknown, user?: CurrentUser) {
    const input = validateStartAttempt(body);
    const mission = await this.requirePublishedMission(missionId);
    await this.requireAccess(mission.isFreeSample, user);
    if (!user && !mission.isFreeSample) {
      throw new ApiError("AUTH_REQUIRED", "로그인 후 문제를 시작해 주세요.", HttpStatus.UNAUTHORIZED);
    }
    if (input.clientAttemptId) {
      const existing = await this.prisma.missionAttempt.findUnique({
        where: { clientAttemptId: input.clientAttemptId },
      });
      if (existing) {
        if (existing.missionId !== missionId || existing.userId !== (user?.id ?? null)) {
          throw new ApiError("MISSION_ATTEMPT_CONFLICT", "이미 사용된 시도 식별자입니다.", HttpStatus.CONFLICT);
        }
        return { attempt: attemptView(existing), mission: publicMission(mission, true) };
      }
    }
    const snapshot = missionSnapshot(mission);
    const initialBoard = createInitialBoard(
      snapshot.boardSize,
      snapshot.initialBlackStones,
      snapshot.initialWhiteStones,
    );
    const attempt = await this.prisma.missionAttempt.create({
      data: {
        missionId,
        missionVersion: mission.version,
        userId: user?.id ?? null,
        source: input.source,
        currentNodeId: snapshot.solutionTree.rootNodeId,
        missionSnapshot: snapshot as never,
        boardState: initialBoard,
        boardHash: boardHash(initialBoard),
        clientAttemptId: input.clientAttemptId,
      },
    });
    return { attempt: attemptView(attempt), mission: publicMission(mission, true) };
  }

  async getAttempt(attemptId: string, user?: CurrentUser) {
    const attempt = await this.prisma.missionAttempt.findUnique({
      where: { id: attemptId },
      include: { mission: true, moves: { orderBy: { moveNumber: "asc" } } },
    });
    if (!attempt) throw new ApiError("MISSION_ATTEMPT_NOT_FOUND", "풀이 기록을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    this.assertAttemptOwner(attempt, user);
    return {
      attempt: attemptView(attempt),
      mission: publicMission(attempt.mission, true),
      moves: attempt.moves.map((move) => ({
        moveNumber: move.moveNumber,
        actor: move.actor.toLowerCase(),
        color: move.color,
        x: move.x,
        y: move.y,
        result: move.result.toLowerCase(),
        capturedStones: move.capturedStones,
        playedAt: move.playedAt,
      })),
    };
  }

  async submitMove(attemptId: string, body: unknown, user?: CurrentUser) {
    const input = validateMove(body);
    const attempt = await this.prisma.missionAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw new ApiError("MISSION_ATTEMPT_NOT_FOUND", "풀이 기록을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    this.assertAttemptOwner(attempt, user);
    const duplicate = await this.prisma.missionMove.findUnique({
      where: { attemptId_clientMoveId: { attemptId, clientMoveId: input.clientMoveId } },
    });
    if (duplicate?.response) return duplicate.response;
    if (attempt.status !== MissionAttemptStatus.IN_PROGRESS) {
      throw new ApiError("MISSION_ATTEMPT_FINISHED", "이미 종료된 문제풀이입니다.", HttpStatus.CONFLICT);
    }
    if (
      attempt.missionVersion !== input.missionVersion
      || attempt.moveCount !== input.expectedMoveNumber
      || attempt.boardHash !== input.boardHash
    ) {
      throw new ApiError("MISSION_STATE_CONFLICT", "다른 기기에서 진행 상태가 변경되었습니다.", HttpStatus.CONFLICT);
    }

    const snapshot = attempt.missionSnapshot as unknown as MissionSnapshot;
    const state = attempt.boardState as unknown as BoardState;
    if (snapshot.timeLimitSeconds !== null
      && Date.now() - attempt.startedAt.getTime() >= snapshot.timeLimitSeconds * 1_000) {
      return this.failTimedOutAttempt(attemptId, attempt, snapshot, state, input);
    }
    const evaluation = evaluateMove(snapshot, state, attempt.currentNodeId, input.move);
    const accepted = evaluation.result === "correct" || evaluation.result === "acceptable";
    const wrongMoveCount = attempt.wrongMoveCount
      + (evaluation.result === "incorrect" || evaluation.result === "forbidden" ? 1 : 0);
    const attemptCount = attempt.attemptCount + 1;
    const confirmedMoves = accepted ? 1 + evaluation.opponentMoves.length : 0;
    const moveCount = attempt.moveCount + confirmedMoves;
    const failed = !evaluation.completed
      && snapshot.retryLimit !== null
      && wrongMoveCount >= snapshot.retryLimit;
    const status = evaluation.completed
      ? MissionAttemptStatus.COMPLETED
      : failed ? MissionAttemptStatus.FAILED : MissionAttemptStatus.IN_PROGRESS;
    const score = calculateScore(snapshot.baseScore, wrongMoveCount, attempt.hintLevel, evaluation.completed);
    const feedback = feedbackFor(snapshot, evaluation.result, evaluation.feedbackId, evaluation.reason);
    const response: Record<string, any> = {
      result: evaluation.result,
      reason: evaluation.reason ?? null,
      feedback,
      playerMove: evaluation.playerMove ?? null,
      opponentMoves: evaluation.opponentMoves,
      nextTurn: status === MissionAttemptStatus.IN_PROGRESS ? snapshot.playerColor : null,
      status: status.toLowerCase(),
      score,
      boardState: evaluation.boardState,
      boardHash: evaluation.boardHash,
      moveCount,
      wrongMoveCount,
      attemptCount,
      explanation: evaluation.completed ? snapshot.correctExplanation : null,
      reward: null,
    };

    try {
      await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.missionAttempt.updateMany({
          where: {
            id: attemptId,
            status: MissionAttemptStatus.IN_PROGRESS,
            boardHash: attempt.boardHash,
            moveCount: attempt.moveCount,
          },
          data: {
            status,
            currentNodeId: evaluation.currentNodeId,
            boardState: evaluation.boardState,
            boardHash: evaluation.boardHash,
            moveCount,
            wrongMoveCount,
            attemptCount,
            score,
            lastPlayedAt: new Date(),
            completedAt: evaluation.completed ? new Date() : null,
          },
        });
        if (updated.count !== 1) {
          throw new ApiError("MISSION_STATE_CONFLICT", "진행 상태가 변경되었습니다. 최신 상태를 불러와 주세요.", HttpStatus.CONFLICT);
        }
        if (evaluation.completed && attempt.userId && snapshot.rewardId) {
          const reward = await transaction.reward.findUnique({ where: { id: snapshot.rewardId } });
          if (reward) {
            const grant = await transaction.rewardGrant.createMany({
              data: [{
                userId: attempt.userId,
                rewardId: reward.id,
                missionId: attempt.missionId,
                attemptId: attempt.id,
                rewardTypeSnapshot: reward.type,
                rewardTitleSnapshot: reward.title,
                quantity: snapshot.rewardQuantity ?? 1,
              }],
              skipDuplicates: true,
            });
            response.reward = {
              id: reward.id,
              type: String(reward.type).toLowerCase(),
              title: reward.title,
              quantity: snapshot.rewardQuantity ?? 1,
              newlyGranted: grant.count === 1,
            };
          }
        }
        const existingMoveCount = await transaction.missionMove.count({ where: { attemptId } });
        await transaction.missionMove.create({
          data: {
            attemptId,
            clientMoveId: input.clientMoveId,
            moveNumber: existingMoveCount + 1,
            actor: MissionMoveActor.PLAYER,
            color: snapshot.playerColor,
            x: input.move.x,
            y: input.move.y,
            result: MOVE_RESULTS[evaluation.result],
            capturedStones: evaluation.playerMove?.capturedStones ?? [],
            nodeId: attempt.currentNodeId,
            boardHash: evaluation.playerMove?.boardHash ?? attempt.boardHash,
            response,
          },
        });
        for (const [index, opponentMove] of evaluation.opponentMoves.entries()) {
          await transaction.missionMove.create({
            data: {
              attemptId,
              clientMoveId: `${input.clientMoveId}:opponent:${index + 1}`,
              moveNumber: existingMoveCount + index + 2,
              actor: MissionMoveActor.OPPONENT,
              color: opponentMove.color,
              x: opponentMove.x,
              y: opponentMove.y,
              result: MissionMoveResult.CORRECT,
              capturedStones: opponentMove.capturedStones,
              nodeId: evaluation.currentNodeId,
              boardHash: opponentMove.boardHash,
            },
          });
        }
        if (evaluation.completed) {
          await transaction.auditLog.create({
            data: {
              actorId: attempt.userId,
              action: "mission.attempt.completed",
              resourceType: "MissionAttempt",
              resourceId: attempt.id,
              metadata: {
                missionId: attempt.missionId,
                score,
                wrongMoveCount,
                hintLevel: attempt.hintLevel,
                reward: response.reward,
              },
            },
          });
        }
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (isUniqueConstraintError(error)) {
        const retried = await this.prisma.missionMove.findUnique({
          where: { attemptId_clientMoveId: { attemptId, clientMoveId: input.clientMoveId } },
        });
        if (retried?.response) return retried.response;
      }
      throw error;
    }
    return response;
  }

  async useHint(attemptId: string, user?: CurrentUser) {
    const attempt = await this.prisma.missionAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw new ApiError("MISSION_ATTEMPT_NOT_FOUND", "풀이 기록을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    this.assertAttemptOwner(attempt, user);
    if (attempt.status !== MissionAttemptStatus.IN_PROGRESS) {
      throw new ApiError("MISSION_ATTEMPT_FINISHED", "이미 종료된 문제풀이입니다.", HttpStatus.CONFLICT);
    }
    const snapshot = attempt.missionSnapshot as unknown as MissionSnapshot;
    const nextLevel = Math.min(attempt.hintLevel + 1, snapshot.hints.length);
    if (nextLevel === attempt.hintLevel) {
      throw new ApiError("MISSION_HINT_EXHAUSTED", "더 이상 제공할 힌트가 없습니다.", HttpStatus.CONFLICT);
    }
    const score = calculateScore(snapshot.baseScore, attempt.wrongMoveCount, nextLevel, false);
    await this.prisma.missionAttempt.update({
      where: { id: attemptId },
      data: { hintLevel: nextLevel, hintUseCount: { increment: 1 }, score, lastPlayedAt: new Date() },
    });
    return { hintLevel: nextLevel, hint: snapshot.hints[nextLevel - 1], score };
  }

  async retry(attemptId: string, user?: CurrentUser) {
    const attempt = await this.prisma.missionAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw new ApiError("MISSION_ATTEMPT_NOT_FOUND", "풀이 기록을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    this.assertAttemptOwner(attempt, user);
    const snapshot = attempt.missionSnapshot as unknown as MissionSnapshot;
    const initialBoard = createInitialBoard(snapshot.boardSize, snapshot.initialBlackStones, snapshot.initialWhiteStones);
    const updated = await this.prisma.missionAttempt.update({
      where: { id: attemptId },
      data: {
        status: MissionAttemptStatus.IN_PROGRESS,
        currentNodeId: snapshot.solutionTree.rootNodeId,
        boardState: initialBoard,
        boardHash: boardHash(initialBoard),
        moveCount: 0,
        wrongMoveCount: 0,
        attemptCount: 0,
        hintLevel: 0,
        hintUseCount: 0,
        score: 0,
        startedAt: new Date(),
        lastPlayedAt: new Date(),
        completedAt: null,
      },
    });
    return { attempt: attemptView(updated) };
  }

  async listMine(user: CurrentUser, statusValue?: string) {
    const status = statusValue ? readAttemptStatus(statusValue) : undefined;
    const items = await this.prisma.missionAttempt.findMany({
      where: { userId: user.id, ...(status ? { status } : {}) },
      include: { mission: true },
      orderBy: { lastPlayedAt: "desc" },
    });
    return { items: items.map((item) => ({ ...attemptView(item), mission: publicMission(item.mission) })) };
  }

  async wrongNote(user: CurrentUser) {
    const attempts = await this.prisma.missionAttempt.findMany({
      where: { userId: user.id },
      include: { mission: true },
      orderBy: { lastPlayedAt: "desc" },
    });
    const byMission = new Map<string, {
      latest: typeof attempts[number];
      hadWrongAnswer: boolean;
      historicalWrongMoveCount: number;
      bestScore: number;
    }>();
    for (const attempt of attempts) {
      const current = byMission.get(attempt.missionId);
      if (!current) {
        byMission.set(attempt.missionId, {
          latest: attempt,
          hadWrongAnswer: attempt.wrongMoveCount > 0,
          historicalWrongMoveCount: attempt.wrongMoveCount,
          bestScore: attempt.score,
        });
        continue;
      }
      current.hadWrongAnswer ||= attempt.wrongMoveCount > 0;
      current.historicalWrongMoveCount += attempt.wrongMoveCount;
      current.bestScore = Math.max(current.bestScore, attempt.score);
    }
    return {
      items: [...byMission.values()]
        .filter((summary) => summary.hadWrongAnswer)
        .map((summary) => ({
          ...attemptView(summary.latest),
          mission: publicMission(summary.latest.mission),
          latestResult: String(summary.latest.status).toLowerCase(),
          reviewCompleted: summary.latest.status === MissionAttemptStatus.COMPLETED,
          historicalWrongMoveCount: summary.historicalWrongMoveCount,
          bestScore: summary.bestScore,
        })),
    };
  }

  async listRewards(user: CurrentUser) {
    const grants = await this.prisma.rewardGrant.findMany({
      where: { userId: user.id },
      include: { mission: { select: { id: true, title: true, boardSize: true } } },
      orderBy: { grantedAt: "desc" },
    });
    const totals = grants.reduce((summary, grant) => {
      const type = String(grant.rewardTypeSnapshot).toLowerCase();
      if (type === "star") summary.stars += grant.quantity;
      if (type === "badge") summary.badges += grant.quantity;
      if (type === "artifact_card") summary.artifactCards += grant.quantity;
      return summary;
    }, { stars: 0, badges: 0, artifactCards: 0 });
    return {
      totals,
      items: grants.map((grant) => ({
        id: grant.id,
        reward: {
          id: grant.rewardId,
          type: String(grant.rewardTypeSnapshot).toLowerCase(),
          title: grant.rewardTitleSnapshot,
          quantity: grant.quantity,
        },
        source: { type: "mission", mission: grant.mission, attemptId: grant.attemptId },
        grantedAt: grant.grantedAt,
      })),
    };
  }

  private async failTimedOutAttempt(
    attemptId: string,
    attempt: Record<string, any>,
    snapshot: MissionSnapshot,
    state: BoardState,
    input: ReturnType<typeof validateMove>,
  ) {
    const attemptCount = attempt.attemptCount + 1;
    const response = {
      result: "timeout" as const,
      reason: "time_limit",
      feedback: "제한시간이 지나 이번 도전이 종료되었습니다. 처음부터 다시 풀어 보세요.",
      playerMove: null,
      opponentMoves: [],
      nextTurn: null,
      status: "failed" as const,
      score: calculateScore(snapshot.baseScore, attempt.wrongMoveCount, attempt.hintLevel, false),
      boardState: state,
      boardHash: attempt.boardHash,
      moveCount: attempt.moveCount,
      wrongMoveCount: attempt.wrongMoveCount,
      attemptCount,
      explanation: null,
    };
    try {
      await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.missionAttempt.updateMany({
          where: {
            id: attemptId,
            status: MissionAttemptStatus.IN_PROGRESS,
            boardHash: attempt.boardHash,
            moveCount: attempt.moveCount,
          },
          data: {
            status: MissionAttemptStatus.FAILED,
            attemptCount,
            score: response.score,
            lastPlayedAt: new Date(),
          },
        });
        if (updated.count !== 1) {
          throw new ApiError("MISSION_STATE_CONFLICT", "진행 상태가 변경되었습니다. 최신 상태를 불러와 주세요.", HttpStatus.CONFLICT);
        }
        const existingMoveCount = await transaction.missionMove.count({ where: { attemptId } });
        await transaction.missionMove.create({
          data: {
            attemptId,
            clientMoveId: input.clientMoveId,
            moveNumber: existingMoveCount + 1,
            actor: MissionMoveActor.PLAYER,
            color: snapshot.playerColor,
            x: input.move.x,
            y: input.move.y,
            result: MissionMoveResult.TIMEOUT,
            capturedStones: [],
            nodeId: attempt.currentNodeId,
            boardHash: attempt.boardHash,
            response,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: attempt.userId,
            action: "mission.attempt.timed_out",
            resourceType: "MissionAttempt",
            resourceId: attempt.id,
            metadata: { missionId: attempt.missionId, timeLimitSeconds: snapshot.timeLimitSeconds },
          },
        });
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (isUniqueConstraintError(error)) {
        const retried = await this.prisma.missionMove.findUnique({
          where: { attemptId_clientMoveId: { attemptId, clientMoveId: input.clientMoveId } },
        });
        if (retried?.response) return retried.response;
      }
      throw error;
    }
    return response;
  }

  private async requirePublishedMission(missionId: string) {
    const mission = await this.prisma.badukMission.findFirst({
      where: { id: missionId, ...publicAvailabilityWhere() },
    });
    if (!mission) throw new ApiError("MISSION_NOT_FOUND", "공개된 바둑미션을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    return mission;
  }

  private async requireAccess(isFreeSample: boolean, user?: CurrentUser) {
    if (isFreeSample) return;
    if (user?.roles.some((role) => role === "operator" || role === "admin")) return;
    if (!user) throw new ApiError("AUTH_REQUIRED", "구독 전용 미션은 로그인 후 이용할 수 있습니다.", HttpStatus.UNAUTHORIZED);
    const now = new Date();
    const subscription = await this.prisma.accountSubscription.findFirst({
      where: {
        userId: user.id,
        paymentStatus: SubscriptionPaymentStatus.PAID,
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      select: { id: true },
    });
    if (!subscription) throw new ApiError("SUBSCRIPTION_REQUIRED", "활성 구독이 필요한 바둑미션입니다.", HttpStatus.FORBIDDEN);
  }

  private assertAttemptOwner(attempt: { userId: string | null }, user?: CurrentUser) {
    if (attempt.userId === null) return;
    if (attempt.userId === user?.id || user?.roles.some((role) => role === "operator" || role === "admin")) return;
    throw new ApiError("MISSION_ATTEMPT_FORBIDDEN", "이 문제풀이 기록에 접근할 수 없습니다.", HttpStatus.FORBIDDEN);
  }
}

function publicMission(mission: Record<string, any>, includeBoard = false) {
  return {
    id: mission.id,
    version: mission.version,
    title: mission.title,
    instruction: mission.instruction,
    level: mission.level,
    volume: mission.volume,
    lessonNumber: mission.lessonNumber,
    problemGroup: mission.problemGroup,
    category: mission.category,
    difficulty: mission.difficulty,
    boardSize: mission.boardSize,
    playerColor: mission.playerColor,
    missionType: mission.missionType,
    baseScore: mission.baseScore,
    timeLimitSeconds: mission.timeLimitSeconds,
    retryLimit: mission.retryLimit,
    isFreeSample: mission.isFreeSample,
    reward: { id: mission.rewardId, quantity: mission.rewardQuantity },
    ...(includeBoard ? {
      initialBlackStones: mission.initialBlackStones,
      initialWhiteStones: mission.initialWhiteStones,
      hintsAvailable: Array.isArray(mission.hints) ? mission.hints.length : 0,
    } : {}),
  };
}

function missionSnapshot(mission: Record<string, any>): MissionSnapshot {
  if (!isBoardSize(mission.boardSize) || !isStoneColor(mission.playerColor)) {
    throw new ApiError("MISSION_CONFIGURATION_INVALID", "바둑미션 설정이 올바르지 않습니다.", HttpStatus.INTERNAL_SERVER_ERROR);
  }
  return {
    boardSize: mission.boardSize,
    playerColor: mission.playerColor,
    initialBlackStones: pointArray(mission.initialBlackStones),
    initialWhiteStones: pointArray(mission.initialWhiteStones),
    solutionTree: mission.solutionTree as SolutionTree,
    hints: Array.isArray(mission.hints) ? mission.hints : [],
    feedbacks: mission.feedbacks && typeof mission.feedbacks === "object" ? mission.feedbacks : {},
    correctExplanation: mission.correctExplanation,
    baseScore: mission.baseScore,
    retryLimit: mission.retryLimit,
    timeLimitSeconds: mission.timeLimitSeconds,
    rewardId: mission.rewardId,
    rewardQuantity: mission.rewardQuantity,
  };
}

function pointArray(value: unknown): Point[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => item && typeof item === "object"
    && Number.isInteger((item as Point).x) && Number.isInteger((item as Point).y)
    ? [{ x: (item as Point).x, y: (item as Point).y }]
    : []);
}

function attemptView(attempt: Record<string, any>) {
  return {
    id: attempt.id,
    missionId: attempt.missionId,
    missionVersion: attempt.missionVersion,
    source: attempt.source,
    status: String(attempt.status).toLowerCase(),
    boardState: attempt.boardState,
    boardHash: attempt.boardHash,
    moveCount: attempt.moveCount,
    wrongMoveCount: attempt.wrongMoveCount,
    attemptCount: attempt.attemptCount,
    hintLevel: attempt.hintLevel,
    hintUseCount: attempt.hintUseCount,
    score: attempt.score,
    startedAt: attempt.startedAt,
    lastPlayedAt: attempt.lastPlayedAt,
    completedAt: attempt.completedAt,
  };
}

function validateStartAttempt(body: unknown): { source: string; clientAttemptId: string | null } {
  const data = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const source = readString(data.source) || "mission_list";
  const clientAttemptId = readString(data.clientAttemptId) || null;
  if (!/^[a-z_]{2,30}$/.test(source)) throw new ApiError("MISSION_SOURCE_INVALID", "문제 진입 경로가 올바르지 않습니다.", HttpStatus.BAD_REQUEST);
  if (clientAttemptId && !/^[A-Za-z0-9_-]{8,80}$/.test(clientAttemptId)) {
    throw new ApiError("MISSION_ATTEMPT_ID_INVALID", "시도 식별자가 올바르지 않습니다.", HttpStatus.BAD_REQUEST);
  }
  return { source, clientAttemptId };
}

function validateResumeAttemptId(value: string | undefined) {
  if (value === undefined || value === "") return null;
  const normalized = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(normalized)) {
    throw new ApiError("MISSION_ATTEMPT_ID_INVALID", "이어갈 문제풀이 식별자가 올바르지 않습니다.", HttpStatus.BAD_REQUEST);
  }
  return normalized;
}

function validateMove(body: unknown) {
  const data = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const move = data.move && typeof data.move === "object" ? data.move as Record<string, unknown> : {};
  const clientMoveId = readString(data.clientMoveId);
  const missionVersion = optionalInteger(data.missionVersion);
  const expectedMoveNumber = optionalInteger(data.expectedMoveNumber);
  const currentBoardHash = readString(data.boardHash);
  const x = optionalInteger(move.x);
  const y = optionalInteger(move.y);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(clientMoveId)
    || missionVersion === undefined || expectedMoveNumber === undefined
    || !/^[a-f0-9]{64}$/.test(currentBoardHash) || x === undefined || y === undefined) {
    throw new ApiError("MISSION_MOVE_INVALID", "착수 요청을 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  return { clientMoveId, missionVersion, expectedMoveNumber, boardHash: currentBoardHash, move: { x, y } };
}

function calculateScore(base: number, wrong: number, hintLevel: number, completed: boolean): number {
  const score = Math.max(0, base - wrong * 10 - hintLevel * 10);
  return completed ? score : score;
}

function feedbackFor(
  snapshot: MissionSnapshot,
  result: string,
  feedbackId?: string,
  reason?: string,
): string {
  if (feedbackId && snapshot.feedbacks[feedbackId]) return snapshot.feedbacks[feedbackId];
  if (reason) {
    return {
      out_of_bounds: "바둑판 안의 교차점을 선택해 주세요.",
      occupied: "이미 돌이 놓인 자리입니다.",
      suicide: "자충이 되는 자리에는 둘 수 없습니다.",
      ko: "패 규칙으로 바로 되잡을 수 없습니다.",
    }[reason] ?? "둘 수 없는 자리입니다.";
  }
  return snapshot.feedbacks[result] ?? (result === "incorrect" ? "다른 수를 생각해 보세요." : "좋은 수입니다.");
}

function readAttemptStatus(value: string): MissionAttemptStatus {
  const normalized = value.trim().toUpperCase();
  if (normalized === "IN_PROGRESS" || normalized === "COMPLETED" || normalized === "FAILED") {
    return normalized as MissionAttemptStatus;
  }
  throw new ApiError("MISSION_STATUS_INVALID", "풀이 상태 필터가 올바르지 않습니다.", HttpStatus.BAD_REQUEST);
}

function readProgressFilter(value: unknown): "not_started" | "in_progress" | "completed" | "failed" | undefined {
  const normalized = readString(value).toLowerCase();
  if (!normalized) return undefined;
  if (["not_started", "in_progress", "completed", "failed"].includes(normalized)) {
    return normalized as "not_started" | "in_progress" | "completed" | "failed";
  }
  throw new ApiError("MISSION_PROGRESS_FILTER_INVALID", "풀이 상태 필터를 확인해 주세요.", HttpStatus.BAD_REQUEST);
}

function readBooleanFilter(value: unknown): boolean {
  if (value === undefined || value === null || value === "" || value === false || value === "false") return false;
  if (value === true || value === "true") return true;
  throw new ApiError("MISSION_BOOLEAN_FILTER_INVALID", "즐겨찾기 필터를 확인해 주세요.", HttpStatus.BAD_REQUEST);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return undefined;
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

function publicAvailabilityWhere() {
  return {
    AND: [{
      OR: [
        { status: BadukMissionStatus.PUBLISHED },
        { status: BadukMissionStatus.SCHEDULED, scheduledAt: { lte: new Date() } },
      ],
    }],
  };
}

export { missionSnapshot };
