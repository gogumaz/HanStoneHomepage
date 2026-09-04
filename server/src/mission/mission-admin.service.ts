import { randomUUID } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import { BadukMissionStatus } from "../generated/prisma/enums.js";
import {
  boardHash,
  createInitialBoard,
  evaluateMove,
  isBoardSize,
  isStoneColor,
  validateMissionDefinition,
  type MissionSnapshot,
  type Point,
  type SolutionTree,
} from "./go-engine.js";

@Injectable()
export class MissionAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: Record<string, unknown>) {
    const status = readStatus(query.status);
    const boardSize = readInteger(query.boardSize);
    const level = readString(query.level);
    const items = await this.prisma.badukMission.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(level ? { level } : {}),
        ...(boardSize !== undefined ? { boardSize } : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { displayOrder: "asc" }],
    });
    return { items: items.map(adminMission) };
  }

  async get(missionId: string) {
    const mission = await this.requireMission(missionId);
    return { mission: adminMission(mission) };
  }

  async create(user: CurrentUser, body: unknown, requestId?: string) {
    const input = validateMissionInput(body, true);
    const id = input.id || `MISSION-${randomUUID().slice(0, 8).toUpperCase()}`;
    const existing = await this.prisma.badukMission.findUnique({ where: { id } });
    if (existing) throw new ApiError("MISSION_ID_EXISTS", "이미 사용 중인 문제 ID입니다.", HttpStatus.CONFLICT);
    const mission = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.badukMission.create({
        data: {
          id,
          ...input.data,
          createdById: user.id,
          updatedById: user.id,
        } as never,
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "mission.created",
          resourceType: "BadukMission",
          resourceId: created.id,
          requestId: requestId ?? null,
          metadata: { boardSize: created.boardSize, status: created.status.toLowerCase() },
        },
      });
      return created;
    });
    return { mission: adminMission(mission) };
  }

  async update(user: CurrentUser, missionId: string, body: unknown, requestId?: string) {
    const existing = await this.requireMission(missionId);
    const input = validateMissionInput(body, false, existing);
    const changedFields = Object.keys(input.data);
    const mission = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.badukMission.update({
        where: { id: missionId },
        data: {
          ...input.data,
          version: { increment: 1 },
          updatedById: user.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "mission.updated",
          resourceType: "BadukMission",
          resourceId: missionId,
          requestId: requestId ?? null,
          metadata: { changedFields, version: updated.version },
        },
      });
      return updated;
    });
    return { mission: adminMission(mission) };
  }

  async validate(missionId: string) {
    const mission = await this.requireMission(missionId);
    const errors = validateMissionDefinition(toValidationSnapshot(mission));
    return { valid: errors.length === 0, errors, checkedAt: new Date() };
  }

  async preview(missionId: string, body: unknown) {
    const mission = await this.requireMission(missionId);
    const snapshot = toValidationSnapshot(mission);
    const errors = validateMissionDefinition(snapshot);
    if (errors.length) {
      throw new ApiError("MISSION_VALIDATION_FAILED", `미리보기 전에 문제를 수정해 주세요: ${errors[0]}`, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const moves = previewMoves(body, snapshot.boardSize);
    let state = createInitialBoard(snapshot.boardSize, snapshot.initialBlackStones, snapshot.initialWhiteStones);
    let currentNodeId = snapshot.solutionTree.rootNodeId;
    let status: "in_progress" | "completed" | "failed" = "in_progress";
    let wrongMoveCount = 0;
    let moveCount = 0;
    const steps: Array<Record<string, unknown>> = [];

    for (const [index, point] of moves.entries()) {
      if (status !== "in_progress") {
        throw new ApiError("MISSION_PREVIEW_FINISHED", `${index + 1}번째 수 전에 이미 미션이 종료되었습니다.`, HttpStatus.BAD_REQUEST);
      }
      const evaluation = evaluateMove(snapshot, state, currentNodeId, point);
      const accepted = evaluation.result === "correct" || evaluation.result === "acceptable";
      if (accepted) {
        state = evaluation.boardState;
        currentNodeId = evaluation.currentNodeId;
        moveCount += 1 + evaluation.opponentMoves.length;
      } else if (evaluation.result === "incorrect" || evaluation.result === "forbidden") {
        wrongMoveCount += 1;
      }
      const terminal = snapshot.solutionTree.nodes[evaluation.currentNodeId]?.terminal;
      status = evaluation.completed ? "completed"
        : terminal === "failure" || (snapshot.retryLimit !== null && wrongMoveCount >= snapshot.retryLimit)
          ? "failed" : "in_progress";
      steps.push({
        number: index + 1,
        point,
        result: evaluation.result,
        reason: evaluation.reason ?? null,
        feedback: previewFeedback(snapshot, evaluation.result, evaluation.feedbackId, evaluation.reason),
        playerMove: evaluation.playerMove ?? null,
        opponentMoves: evaluation.opponentMoves,
        status,
      });
    }

    return {
      preview: {
        missionId: mission.id,
        missionVersion: mission.version,
        status,
        currentNodeId,
        boardState: state,
        boardHash: boardHash(state),
        moveCount,
        wrongMoveCount,
        score: Math.max(0, snapshot.baseScore - wrongMoveCount * 10),
        steps,
        explanation: status === "completed" ? snapshot.correctExplanation : null,
        persisted: false,
      },
    };
  }

  async statistics(missionId: string) {
    const mission = await this.requireMission(missionId);
    const attempts = await this.prisma.missionAttempt.findMany({
      where: { missionId },
      select: {
        userId: true,
        status: true,
        score: true,
        wrongMoveCount: true,
        attemptCount: true,
        hintUseCount: true,
        startedAt: true,
        completedAt: true,
        moves: { select: { actor: true, result: true } },
      },
    });
    const completed = attempts.filter((attempt) => String(attempt.status) === "COMPLETED");
    const resultCounts = { correct: 0, acceptable: 0, incorrect: 0, forbidden: 0, illegal: 0, timeout: 0 };
    for (const attempt of attempts) {
      for (const move of attempt.moves) {
        if (String(move.actor) !== "PLAYER") continue;
        const result = String(move.result).toLowerCase() as keyof typeof resultCounts;
        if (result in resultCounts) resultCounts[result] += 1;
      }
    }
    const durations = completed.flatMap((attempt) => attempt.completedAt
      ? [Math.max(0, (attempt.completedAt.getTime() - attempt.startedAt.getTime()) / 1_000)] : []);
    return {
      mission: { id: mission.id, title: mission.title, version: mission.version, boardSize: mission.boardSize },
      summary: {
        totalAttempts: attempts.length,
        uniqueLearners: new Set(attempts.flatMap((attempt) => attempt.userId ? [attempt.userId] : [])).size,
        inProgress: attempts.filter((attempt) => String(attempt.status) === "IN_PROGRESS").length,
        completed: completed.length,
        failed: attempts.filter((attempt) => String(attempt.status) === "FAILED").length,
        completionRate: attempts.length ? round(completed.length / attempts.length * 100) : 0,
        averageScore: average(attempts.map((attempt) => attempt.score)),
        averageWrongMoves: average(attempts.map((attempt) => attempt.wrongMoveCount)),
        averageHintUses: average(attempts.map((attempt) => attempt.hintUseCount)),
        averageSolveSeconds: durations.length ? average(durations) : null,
        submittedMoves: attempts.reduce((sum, attempt) => sum + attempt.attemptCount, 0),
      },
      resultCounts,
      generatedAt: new Date(),
    };
  }

  async requestReview(user: CurrentUser, missionId: string, requestId?: string) {
    const mission = await this.requireMission(missionId);
    const errors = validateMissionDefinition(toValidationSnapshot(mission));
    if (errors.length) {
      throw new ApiError("MISSION_VALIDATION_FAILED", `자동검수를 통과하지 못했습니다: ${errors[0]}`, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return this.changeStatus(user, missionId, BadukMissionStatus.PENDING_REVIEW, requestId);
  }

  async publish(user: CurrentUser, missionId: string, body: unknown, requestId?: string) {
    const mission = await this.requireMission(missionId);
    const errors = validateMissionDefinition(toValidationSnapshot(mission));
    if (errors.length) {
      throw new ApiError("MISSION_VALIDATION_FAILED", `자동검수를 통과하지 못했습니다: ${errors[0]}`, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const data = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const scheduledAtValue = readString(data.scheduledAt);
    const scheduledAt = scheduledAtValue ? new Date(scheduledAtValue) : null;
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
      throw new ApiError("MISSION_SCHEDULE_INVALID", "예약 공개시각을 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    const scheduled = scheduledAt && scheduledAt.getTime() > Date.now();
    const status = scheduled ? BadukMissionStatus.SCHEDULED : BadukMissionStatus.PUBLISHED;
    const updated = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.badukMission.update({
        where: { id: missionId },
        data: {
          status,
          scheduledAt: scheduled ? scheduledAt : null,
          publishedAt: scheduled ? null : new Date(),
          publishedById: user.id,
          updatedById: user.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: scheduled ? "mission.scheduled" : "mission.published",
          resourceType: "BadukMission",
          resourceId: missionId,
          requestId: requestId ?? null,
          metadata: { scheduledAt: scheduledAt?.toISOString() ?? null },
        },
      });
      return result;
    });
    return { mission: adminMission(updated) };
  }

  async archive(user: CurrentUser, missionId: string, requestId?: string) {
    await this.requireMission(missionId);
    return this.changeStatus(user, missionId, BadukMissionStatus.ARCHIVED, requestId);
  }

  private async changeStatus(
    user: CurrentUser,
    missionId: string,
    status: BadukMissionStatus,
    requestId?: string,
  ) {
    const mission = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.badukMission.update({
        where: { id: missionId },
        data: { status, updatedById: user.id },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: `mission.${status.toLowerCase()}`,
          resourceType: "BadukMission",
          resourceId: missionId,
          requestId: requestId ?? null,
        },
      });
      return updated;
    });
    return { mission: adminMission(mission) };
  }

  private async requireMission(missionId: string) {
    const mission = await this.prisma.badukMission.findUnique({ where: { id: missionId } });
    if (!mission) throw new ApiError("MISSION_NOT_FOUND", "바둑문제를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    return mission;
  }
}

function validateMissionInput(body: unknown, create: boolean, current?: Record<string, any>) {
  if (!body || typeof body !== "object") {
    throw new ApiError("MISSION_INPUT_INVALID", "문제 정보를 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  const source = body as Record<string, unknown>;
  const data: Record<string, any> = {};
  const textFields = ["title", "instruction", "level", "problemGroup", "category", "textbookPage", "playerColor", "missionType", "rewardId"] as const;
  for (const field of textFields) {
    if (field in source) data[field] = readString(source[field]) || null;
  }
  const integerFields = ["volume", "lessonNumber", "difficulty", "displayOrder", "boardSize", "baseScore", "timeLimitSeconds", "retryLimit", "rewardQuantity"] as const;
  for (const field of integerFields) {
    if (field in source) {
      if (source[field] === null || source[field] === "") {
        data[field] = null;
      } else {
        const value = readInteger(source[field]);
        if (value === undefined) {
          throw new ApiError("MISSION_NUMBER_INVALID", `${field} 값은 정수여야 합니다.`, HttpStatus.BAD_REQUEST);
        }
        data[field] = value;
      }
    }
  }
  for (const field of ["eraId", "lessonId"] as const) {
    if (field in source) data[field] = readString(source[field]) || null;
  }
  for (const field of ["initialBlackStones", "initialWhiteStones", "solutionTree", "hints", "feedbacks", "successCondition"] as const) {
    if (field in source) data[field] = source[field] ?? null;
  }
  if ("correctExplanation" in source) data.correctExplanation = readString(source.correctExplanation);
  if ("isFreeSample" in source) data.isFreeSample = source.isFreeSample === true;
  if (create) {
    data.rewardId ??= "mission-star";
    data.rewardQuantity ??= 1;
  }

  const merged = { ...current, ...data };
  const requiredText = ["title", "instruction", "level", "problemGroup", "category", "playerColor", "missionType", "correctExplanation", "rewardId", "eraId"];
  if (requiredText.some((field) => !merged[field])) {
    throw new ApiError("MISSION_REQUIRED_FIELD_MISSING", "시대를 포함한 문제 기본정보와 해설을 모두 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  if (merged.title && (merged.title.length < 2 || merged.title.length > 120)) {
    throw new ApiError("MISSION_TITLE_INVALID", "문제 제목은 2자 이상 120자 이하로 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  if (merged.instruction && merged.instruction.length > 500) {
    throw new ApiError("MISSION_INSTRUCTION_INVALID", "문제 지시문은 500자 이하로 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  if (create || "boardSize" in data) {
    if (!isBoardSize(merged.boardSize)) throw new ApiError("MISSION_BOARD_SIZE_INVALID", "판 크기는 9, 13, 19 중 하나여야 합니다.", HttpStatus.BAD_REQUEST);
  }
  if (create || "playerColor" in data) {
    if (!isStoneColor(merged.playerColor)) throw new ApiError("MISSION_COLOR_INVALID", "사용자 돌 색상을 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  if (merged.volume !== undefined && (!Number.isInteger(merged.volume) || merged.volume < 1 || merged.volume > 6)) {
    throw new ApiError("MISSION_VOLUME_INVALID", "권은 1~6 범위여야 합니다.", HttpStatus.BAD_REQUEST);
  }
  if (merged.lessonNumber !== undefined && (!Number.isInteger(merged.lessonNumber) || merged.lessonNumber < 1 || merged.lessonNumber > 8)) {
    throw new ApiError("MISSION_LESSON_INVALID", "강은 1~8 범위여야 합니다.", HttpStatus.BAD_REQUEST);
  }
  if (merged.difficulty !== undefined && (!Number.isInteger(merged.difficulty) || merged.difficulty < 1 || merged.difficulty > 5)) {
    throw new ApiError("MISSION_DIFFICULTY_INVALID", "난이도는 1~5 범위여야 합니다.", HttpStatus.BAD_REQUEST);
  }
  if (merged.baseScore !== undefined && (!Number.isInteger(merged.baseScore) || merged.baseScore < 0 || merged.baseScore > 10000)) {
    throw new ApiError("MISSION_SCORE_INVALID", "배점 범위를 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  if (merged.displayOrder !== undefined && (!Number.isInteger(merged.displayOrder) || merged.displayOrder < 0)) {
    throw new ApiError("MISSION_DISPLAY_ORDER_INVALID", "노출 순서는 0 이상의 정수여야 합니다.", HttpStatus.BAD_REQUEST);
  }
  if (merged.timeLimitSeconds !== null && merged.timeLimitSeconds !== undefined
    && (!Number.isInteger(merged.timeLimitSeconds) || merged.timeLimitSeconds < 1 || merged.timeLimitSeconds > 86_400)) {
    throw new ApiError("MISSION_TIME_LIMIT_INVALID", "제한시간은 1~86,400초 범위여야 합니다.", HttpStatus.BAD_REQUEST);
  }
  if (merged.retryLimit !== null && merged.retryLimit !== undefined
    && (!Number.isInteger(merged.retryLimit) || merged.retryLimit < 1 || merged.retryLimit > 100)) {
    throw new ApiError("MISSION_RETRY_LIMIT_INVALID", "오답 제한은 1~100회 범위여야 합니다.", HttpStatus.BAD_REQUEST);
  }
  if (!Number.isInteger(merged.rewardQuantity) || merged.rewardQuantity < 1 || merged.rewardQuantity > 100) {
    throw new ApiError("MISSION_REWARD_QUANTITY_INVALID", "완료 보상은 1~100개 범위여야 합니다.", HttpStatus.BAD_REQUEST);
  }

  if (data.initialBlackStones !== undefined) data.initialBlackStones = points(data.initialBlackStones);
  if (data.initialWhiteStones !== undefined) data.initialWhiteStones = points(data.initialWhiteStones);
  if (data.solutionTree !== undefined && !isRecord(data.solutionTree)) {
    throw new ApiError("MISSION_SOLUTION_INVALID", "정답 수순 트리를 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  if (data.hints !== undefined && !Array.isArray(data.hints)) {
    throw new ApiError("MISSION_HINTS_INVALID", "힌트 배열을 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  if (data.feedbacks !== undefined && !isRecord(data.feedbacks)) {
    throw new ApiError("MISSION_FEEDBACKS_INVALID", "피드백 형식을 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  if (create) {
    data.initialBlackStones ??= [];
    data.initialWhiteStones ??= [];
    data.hints = Array.isArray(data.hints) ? data.hints : [];
    data.feedbacks = isRecord(data.feedbacks) ? data.feedbacks : {};
    if (!isRecord(data.solutionTree)) throw new ApiError("MISSION_SOLUTION_INVALID", "정답 수순 트리를 입력해 주세요.", HttpStatus.BAD_REQUEST);
    data.volume ??= 1;
    data.lessonNumber ??= 1;
    data.difficulty ??= 1;
    data.displayOrder ??= 0;
    data.baseScore ??= 100;
  }
  return { id: readString(source.id), data };
}

function toValidationSnapshot(mission: Record<string, any>): MissionSnapshot {
  return {
    boardSize: mission.boardSize,
    playerColor: mission.playerColor,
    initialBlackStones: points(mission.initialBlackStones),
    initialWhiteStones: points(mission.initialWhiteStones),
    solutionTree: mission.solutionTree as SolutionTree,
    hints: Array.isArray(mission.hints) ? mission.hints : [],
    feedbacks: isRecord(mission.feedbacks) ? mission.feedbacks as Record<string, string> : {},
    correctExplanation: mission.correctExplanation,
    baseScore: mission.baseScore,
    retryLimit: mission.retryLimit,
    timeLimitSeconds: mission.timeLimitSeconds,
  };
}

function adminMission(mission: Record<string, any>) {
  return {
    id: mission.id,
    version: mission.version,
    title: mission.title,
    instruction: mission.instruction,
    status: String(mission.status).toLowerCase(),
    level: mission.level,
    volume: mission.volume,
    lessonNumber: mission.lessonNumber,
    problemGroup: mission.problemGroup,
    category: mission.category,
    difficulty: mission.difficulty,
    displayOrder: mission.displayOrder,
    eraId: mission.eraId,
    lessonId: mission.lessonId,
    textbookPage: mission.textbookPage,
    boardSize: mission.boardSize,
    ruleset: mission.ruleset,
    playerColor: mission.playerColor,
    initialBlackStones: mission.initialBlackStones,
    initialWhiteStones: mission.initialWhiteStones,
    missionType: mission.missionType,
    successCondition: mission.successCondition,
    solutionTree: mission.solutionTree,
    hints: mission.hints,
    correctExplanation: mission.correctExplanation,
    feedbacks: mission.feedbacks,
    baseScore: mission.baseScore,
    timeLimitSeconds: mission.timeLimitSeconds,
    retryLimit: mission.retryLimit,
    isFreeSample: mission.isFreeSample,
    rewardId: mission.rewardId,
    rewardQuantity: mission.rewardQuantity,
    reward: { id: mission.rewardId, quantity: mission.rewardQuantity },
    scheduledAt: mission.scheduledAt,
    publishedAt: mission.publishedAt,
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
  };
}

function points(value: unknown): Point[] {
  if (!Array.isArray(value)) throw new ApiError("MISSION_STONES_INVALID", "바둑돌 좌표 배열을 확인해 주세요.", HttpStatus.BAD_REQUEST);
  return value.map((item) => {
    if (!isRecord(item) || !Number.isInteger(item.x) || !Number.isInteger(item.y)) {
      throw new ApiError("MISSION_STONES_INVALID", "바둑돌 좌표 배열을 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    return { x: item.x as number, y: item.y as number };
  });
}

function readStatus(value: unknown): BadukMissionStatus | undefined {
  const status = readString(value).toUpperCase();
  if (!status) return undefined;
  if (["DRAFT", "PENDING_REVIEW", "SCHEDULED", "PUBLISHED", "ARCHIVED"].includes(status)) {
    return status as BadukMissionStatus;
  }
  throw new ApiError("MISSION_STATUS_INVALID", "문제 상태를 확인해 주세요.", HttpStatus.BAD_REQUEST);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function previewMoves(body: unknown, boardSize: number): Point[] {
  const data = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (!Array.isArray(data.moves) || data.moves.length > 200) {
    throw new ApiError("MISSION_PREVIEW_MOVES_INVALID", "미리보기 착수는 200수 이하의 배열이어야 합니다.", HttpStatus.BAD_REQUEST);
  }
  return data.moves.map((move) => {
    if (!isRecord(move) || !Number.isInteger(move.x) || !Number.isInteger(move.y)
      || Number(move.x) < 0 || Number(move.y) < 0 || Number(move.x) >= boardSize || Number(move.y) >= boardSize) {
      throw new ApiError("MISSION_PREVIEW_MOVE_INVALID", "미리보기 착수 좌표를 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    return { x: Number(move.x), y: Number(move.y) };
  });
}

function previewFeedback(
  snapshot: MissionSnapshot,
  result: string,
  feedbackId?: string,
  reason?: string,
) {
  if (feedbackId && snapshot.feedbacks[feedbackId]) return snapshot.feedbacks[feedbackId];
  if (reason) return {
    out_of_bounds: "바둑판 안의 교차점을 선택해 주세요.",
    occupied: "이미 돌이 놓인 자리입니다.",
    suicide: "자충이 되는 자리에는 둘 수 없습니다.",
    ko: "패 규칙으로 바로 되잡을 수 없습니다.",
  }[reason] ?? "둘 수 없는 자리입니다.";
  return snapshot.feedbacks[result] ?? (result === "incorrect" ? "다른 수를 생각해 보세요." : "좋은 수입니다.");
}

function average(values: number[]) {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
