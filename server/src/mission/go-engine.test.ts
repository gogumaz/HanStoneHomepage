import { describe, expect, it } from "vitest";
import {
  boardHash,
  createInitialBoard,
  evaluateMove,
  playMove,
  validateMissionDefinition,
  type MissionSnapshot,
} from "./go-engine.js";

function snapshot(overrides: Partial<MissionSnapshot> = {}): MissionSnapshot {
  return {
    boardSize: 9,
    playerColor: "black",
    initialBlackStones: [{ x: 3, y: 4 }, { x: 4, y: 3 }, { x: 5, y: 4 }],
    initialWhiteStones: [{ x: 4, y: 4 }],
    solutionTree: {
      rootNodeId: "root",
      nodes: {
        root: {
          actor: "player",
          acceptedMoves: [{ x: 4, y: 5, result: "correct", nextNodeId: "success" }],
          forbiddenMoves: [{ x: 2, y: 2, feedbackId: "avoid" }],
        },
        success: { terminal: "success" },
      },
    },
    hints: ["활로를 찾으세요."],
    feedbacks: { avoid: "이곳은 목표와 관계없습니다." },
    correctExplanation: "마지막 활로입니다.",
    baseScore: 100,
    retryLimit: null,
    timeLimitSeconds: null,
    ...overrides,
  };
}

describe("Go mission engine", () => {
  it.each([9, 13, 19] as const)("creates and hashes a %i-line board", (size) => {
    const board = createInitialBoard(size, [{ x: 0, y: 0 }], [{ x: size - 1, y: size - 1 }]);
    expect(board.size).toBe(size);
    expect(board.captures).toEqual({ black: 0, white: 0 });
    expect(boardHash(board)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("captures a surrounded group and rejects occupied and suicide moves", () => {
    const board = createInitialBoard(
      9,
      [{ x: 3, y: 4 }, { x: 4, y: 3 }, { x: 5, y: 4 }],
      [{ x: 4, y: 4 }],
    );
    const capture = playMove({ ...board, captures: { black: 2, white: 1 } }, { color: "black", x: 4, y: 5 });
    expect(capture).toMatchObject({ ok: true, capturedStones: [{ x: 4, y: 4 }] });
    expect(capture.ok && capture.state.captures).toEqual({ black: 3, white: 1 });
    if (capture.ok) expect(capture.state.stones).not.toContainEqual({ color: "white", x: 4, y: 4 });
    expect(playMove(board, { color: "black", x: 4, y: 4 })).toEqual({ ok: false, reason: "occupied" });

    const suicideBoard = createInitialBoard(
      9,
      [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 2 }],
      [],
    );
    expect(playMove(suicideBoard, { color: "white", x: 1, y: 1 })).toEqual({ ok: false, reason: "suicide" });
  });

  it("rejects a position repetition with simple ko", () => {
    const board = createInitialBoard(9, [], []);
    const first = playMove(board, { color: "black", x: 4, y: 4 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const repeated = playMove({ ...board, previousPositionHash: boardHash(first.state) }, { color: "black", x: 4, y: 4 });
    expect(repeated).toEqual({ ok: false, reason: "ko" });
  });

  it("distinguishes forbidden, incorrect, illegal, and correct moves", () => {
    const mission = snapshot();
    const board = createInitialBoard(9, mission.initialBlackStones, mission.initialWhiteStones);
    expect(evaluateMove(mission, board, "root", { x: 2, y: 2 })).toMatchObject({ result: "forbidden" });
    expect(evaluateMove(mission, board, "root", { x: 0, y: 0 })).toMatchObject({ result: "incorrect" });
    expect(evaluateMove(mission, board, "root", { x: 4, y: 4 })).toMatchObject({ result: "illegal", reason: "occupied" });
    expect(evaluateMove(mission, board, "root", { x: 4, y: 5 })).toMatchObject({
      result: "correct",
      completed: true,
      playerMove: { capturedStones: [{ x: 4, y: 4 }] },
    });
  });

  it("plays a configured opponent response and continues the sequence", () => {
    const mission = snapshot({
      initialBlackStones: [],
      initialWhiteStones: [],
      solutionTree: {
        rootNodeId: "p1",
        nodes: {
          p1: { actor: "player", acceptedMoves: [{ x: 2, y: 2, result: "correct", nextNodeId: "o1" }] },
          o1: { actor: "opponent", move: { color: "white", x: 3, y: 2 }, nextNodeId: "p2" },
          p2: { actor: "player", acceptedMoves: [{ x: 2, y: 3, result: "acceptable", nextNodeId: "done" }] },
          done: { terminal: "success" },
        },
      },
    });
    const board = createInitialBoard(9, [], []);
    const result = evaluateMove(mission, board, "p1", { x: 2, y: 2 });
    expect(result).toMatchObject({ completed: false, currentNodeId: "p2" });
    expect(result.opponentMoves).toEqual([
      expect.objectContaining({ color: "white", x: 3, y: 2, actor: "opponent" }),
    ]);
  });

  it("validates coordinates, legal branches, cycles, and a reachable success node", () => {
    expect(validateMissionDefinition(snapshot())).toEqual([]);
    const invalid = snapshot({
      solutionTree: {
        rootNodeId: "root",
        nodes: {
          root: { actor: "player", acceptedMoves: [{ x: 99, y: 99, result: "correct", nextNodeId: "root" }] },
          unused: { terminal: "success" },
        },
      },
    });
    expect(validateMissionDefinition(invalid).join(" ")).toMatch(/불법|순환|성공|도달/);
  });
});
