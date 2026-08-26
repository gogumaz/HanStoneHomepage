import { createHash } from "node:crypto";

export type StoneColor = "black" | "white";
export type Point = { x: number; y: number };
export type Stone = Point & { color: StoneColor };

export type BoardState = {
  size: 9 | 13 | 19;
  stones: Stone[];
  previousPositionHash: string | null;
  lastMove: Stone | null;
  captures?: Record<StoneColor, number>;
};

export type AcceptedMove = Point & {
  result: "correct" | "acceptable";
  nextNodeId: string;
};

export type ForbiddenMove = Point & { feedbackId?: string };

export type SolutionNode = {
  actor?: "player" | "opponent";
  acceptedMoves?: AcceptedMove[];
  forbiddenMoves?: ForbiddenMove[];
  move?: Stone;
  nextNodeId?: string;
  terminal?: "success" | "failure";
};

export type SolutionTree = {
  rootNodeId: string;
  nodes: Record<string, SolutionNode>;
};

export type MissionSnapshot = {
  boardSize: 9 | 13 | 19;
  playerColor: StoneColor;
  initialBlackStones: Point[];
  initialWhiteStones: Point[];
  solutionTree: SolutionTree;
  hints: unknown[];
  feedbacks: Record<string, string>;
  correctExplanation: string;
  baseScore: number;
  retryLimit: number | null;
  timeLimitSeconds: number | null;
  rewardId?: string;
  rewardQuantity?: number;
};

export type PlayedMove = {
  actor: "player" | "opponent";
  color: StoneColor;
  x: number;
  y: number;
  capturedStones: Point[];
  boardHash: string;
};

export type MoveEvaluation = {
  result: "correct" | "acceptable" | "incorrect" | "forbidden" | "illegal";
  reason?: "out_of_bounds" | "occupied" | "suicide" | "ko";
  feedbackId?: string;
  boardState: BoardState;
  boardHash: string;
  currentNodeId: string;
  playerMove?: PlayedMove;
  opponentMoves: PlayedMove[];
  completed: boolean;
};

const BOARD_SIZES = new Set([9, 13, 19]);
const keyOf = ({ x, y }: Point) => `${x}:${y}`;
const opposite = (color: StoneColor): StoneColor => color === "black" ? "white" : "black";

export function isBoardSize(value: unknown): value is 9 | 13 | 19 {
  return typeof value === "number" && BOARD_SIZES.has(value);
}

export function isStoneColor(value: unknown): value is StoneColor {
  return value === "black" || value === "white";
}

export function boardHash(state: Pick<BoardState, "size" | "stones">): string {
  const stones = [...state.stones]
    .sort((left, right) => left.y - right.y || left.x - right.x || left.color.localeCompare(right.color))
    .map((stone) => `${stone.color[0]}:${stone.x}:${stone.y}`)
    .join("|");
  return createHash("sha256").update(`${state.size}|${stones}`).digest("hex");
}

export function createInitialBoard(
  size: 9 | 13 | 19,
  blackStones: Point[],
  whiteStones: Point[],
): BoardState {
  const occupied = new Set<string>();
  const stones: Stone[] = [];
  for (const [color, points] of [["black", blackStones], ["white", whiteStones]] as const) {
    for (const point of points) {
      assertPoint(point, size);
      const key = keyOf(point);
      if (occupied.has(key)) throw new Error(`duplicate_stone:${key}`);
      occupied.add(key);
      stones.push({ ...point, color });
    }
  }
  return { size, stones, previousPositionHash: null, lastMove: null, captures: { black: 0, white: 0 } };
}

export function playMove(
  state: BoardState,
  move: Stone,
): { ok: true; state: BoardState; capturedStones: Point[] } | {
  ok: false;
  reason: "out_of_bounds" | "occupied" | "suicide" | "ko";
} {
  if (!inBounds(move, state.size)) return { ok: false, reason: "out_of_bounds" };
  const board = toBoardMap(state.stones);
  if (board.has(keyOf(move))) return { ok: false, reason: "occupied" };
  board.set(keyOf(move), move.color);

  const capturedStones: Point[] = [];
  for (const neighbor of neighbors(move, state.size)) {
    if (board.get(keyOf(neighbor)) !== opposite(move.color)) continue;
    const group = collectGroup(board, neighbor, state.size);
    if (group.liberties.size === 0) {
      for (const point of group.stones) {
        board.delete(keyOf(point));
        capturedStones.push(point);
      }
    }
  }

  const ownGroup = collectGroup(board, move, state.size);
  if (ownGroup.liberties.size === 0) return { ok: false, reason: "suicide" };

  const stones = [...board.entries()].map(([key, color]) => {
    const [x, y] = key.split(":").map(Number);
    return { x, y, color } as Stone;
  });
  const nextHash = boardHash({ size: state.size, stones });
  if (state.previousPositionHash === nextHash) return { ok: false, reason: "ko" };
  const captures = {
    black: state.captures?.black ?? 0,
    white: state.captures?.white ?? 0,
  };
  captures[move.color] += capturedStones.length;
  return {
    ok: true,
    state: {
      size: state.size,
      stones,
      previousPositionHash: boardHash(state),
      lastMove: move,
      captures,
    },
    capturedStones,
  };
}

export function evaluateMove(
  snapshot: MissionSnapshot,
  state: BoardState,
  currentNodeId: string,
  point: Point,
): MoveEvaluation {
  const node = snapshot.solutionTree.nodes[currentNodeId];
  const currentHash = boardHash(state);
  if (!node || node.actor !== "player") {
    return {
      result: "illegal",
      reason: "out_of_bounds",
      boardState: state,
      boardHash: currentHash,
      currentNodeId,
      opponentMoves: [],
      completed: false,
    };
  }

  const forbidden = node.forbiddenMoves?.find((candidate) => samePoint(candidate, point));
  if (forbidden) {
    return {
      result: "forbidden",
      ...(forbidden.feedbackId ? { feedbackId: forbidden.feedbackId } : {}),
      boardState: state,
      boardHash: currentHash,
      currentNodeId,
      opponentMoves: [],
      completed: false,
    };
  }
  const accepted = node.acceptedMoves?.find((candidate) => samePoint(candidate, point));
  if (!accepted) {
    const attempted = playMove(state, { ...point, color: snapshot.playerColor });
    if (!attempted.ok) {
      return {
        result: "illegal",
        reason: attempted.reason,
        boardState: state,
        boardHash: currentHash,
        currentNodeId,
        opponentMoves: [],
        completed: false,
      };
    }
    return {
      result: "incorrect",
      boardState: state,
      boardHash: currentHash,
      currentNodeId,
      opponentMoves: [],
      completed: false,
    };
  }

  const played = playMove(state, { ...point, color: snapshot.playerColor });
  if (!played.ok) {
    return {
      result: "illegal",
      reason: played.reason,
      boardState: state,
      boardHash: currentHash,
      currentNodeId,
      opponentMoves: [],
      completed: false,
    };
  }

  let nextState = played.state;
  let nextNodeId = accepted.nextNodeId;
  const playerMove: PlayedMove = {
    actor: "player",
    color: snapshot.playerColor,
    ...point,
    capturedStones: played.capturedStones,
    boardHash: boardHash(nextState),
  };
  const opponentMoves: PlayedMove[] = [];
  const visited = new Set<string>();
  while (true) {
    if (visited.has(nextNodeId)) throw new Error(`solution_cycle:${nextNodeId}`);
    visited.add(nextNodeId);
    const nextNode = snapshot.solutionTree.nodes[nextNodeId];
    if (!nextNode) throw new Error(`solution_node_missing:${nextNodeId}`);
    if (nextNode.terminal) {
      return {
        result: accepted.result,
        boardState: nextState,
        boardHash: boardHash(nextState),
        currentNodeId: nextNodeId,
        playerMove,
        opponentMoves,
        completed: nextNode.terminal === "success",
      };
    }
    if (nextNode.actor === "player") {
      return {
        result: accepted.result,
        boardState: nextState,
        boardHash: boardHash(nextState),
        currentNodeId: nextNodeId,
        playerMove,
        opponentMoves,
        completed: false,
      };
    }
    if (nextNode.actor !== "opponent" || !nextNode.move || !nextNode.nextNodeId) {
      throw new Error(`solution_node_invalid:${nextNodeId}`);
    }
    const opponent = playMove(nextState, nextNode.move);
    if (!opponent.ok) throw new Error(`solution_opponent_move_${opponent.reason}:${nextNodeId}`);
    nextState = opponent.state;
    opponentMoves.push({
      actor: "opponent",
      ...nextNode.move,
      capturedStones: opponent.capturedStones,
      boardHash: boardHash(nextState),
    });
    nextNodeId = nextNode.nextNodeId;
  }
}

export function validateMissionDefinition(snapshot: MissionSnapshot): string[] {
  const errors: string[] = [];
  if (!isBoardSize(snapshot.boardSize)) errors.push("판 크기는 9, 13, 19 중 하나여야 합니다.");
  if (!isStoneColor(snapshot.playerColor)) errors.push("사용자 돌 색상이 올바르지 않습니다.");
  if (errors.length) return errors;

  let initial: BoardState;
  try {
    initial = createInitialBoard(snapshot.boardSize, snapshot.initialBlackStones, snapshot.initialWhiteStones);
  } catch (error) {
    errors.push(`초기 판 오류: ${error instanceof Error ? error.message : "invalid_board"}`);
    return errors;
  }
  const tree = snapshot.solutionTree;
  if (!tree?.rootNodeId || !tree.nodes?.[tree.rootNodeId]) {
    errors.push("정답 수순의 시작 노드가 없습니다.");
    return errors;
  }

  const reachable = new Set<string>();
  let successPaths = 0;
  const walk = (nodeId: string, state: BoardState, path: Set<string>) => {
    if (path.has(nodeId)) {
      errors.push(`수순에 순환이 있습니다: ${nodeId}`);
      return;
    }
    const node = tree.nodes[nodeId];
    if (!node) {
      errors.push(`존재하지 않는 수순 노드입니다: ${nodeId}`);
      return;
    }
    reachable.add(nodeId);
    if (node.terminal) {
      if (node.terminal === "success") successPaths += 1;
      return;
    }
    const nextPath = new Set(path).add(nodeId);
    if (node.actor === "player") {
      if (!node.acceptedMoves?.length) errors.push(`사용자 노드에 정답 착수가 없습니다: ${nodeId}`);
      for (const forbidden of node.forbiddenMoves ?? []) {
        if (!inBounds(forbidden, snapshot.boardSize)) errors.push(`금지 수 좌표가 판 밖입니다: ${nodeId}`);
      }
      for (const move of node.acceptedMoves ?? []) {
        const result = playMove(state, { x: move.x, y: move.y, color: snapshot.playerColor });
        if (!result.ok) errors.push(`정답 수가 불법입니다: ${nodeId} (${result.reason})`);
        else walk(move.nextNodeId, result.state, nextPath);
      }
      return;
    }
    if (node.actor === "opponent" && node.move && node.nextNodeId) {
      if (node.move.color !== opposite(snapshot.playerColor)) errors.push(`상대 응수 색상이 올바르지 않습니다: ${nodeId}`);
      const result = playMove(state, node.move);
      if (!result.ok) errors.push(`상대 응수가 불법입니다: ${nodeId} (${result.reason})`);
      else walk(node.nextNodeId, result.state, nextPath);
      return;
    }
    errors.push(`수순 노드 형식이 올바르지 않습니다: ${nodeId}`);
  };
  walk(tree.rootNodeId, initial, new Set());
  if (successPaths === 0) errors.push("성공으로 끝나는 정답 경로가 없습니다.");
  for (const nodeId of Object.keys(tree.nodes)) {
    if (!reachable.has(nodeId)) errors.push(`도달할 수 없는 수순 노드입니다: ${nodeId}`);
  }
  return [...new Set(errors)];
}

function assertPoint(point: Point, size: number): void {
  if (!Number.isInteger(point.x) || !Number.isInteger(point.y) || !inBounds(point, size)) {
    throw new Error(`point_out_of_bounds:${point.x}:${point.y}`);
  }
}

function inBounds(point: Point, size: number): boolean {
  return Number.isInteger(point.x) && Number.isInteger(point.y)
    && point.x >= 0 && point.x < size && point.y >= 0 && point.y < size;
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function neighbors(point: Point, size: number): Point[] {
  return [
    { x: point.x - 1, y: point.y },
    { x: point.x + 1, y: point.y },
    { x: point.x, y: point.y - 1 },
    { x: point.x, y: point.y + 1 },
  ].filter((candidate) => inBounds(candidate, size));
}

function toBoardMap(stones: Stone[]): Map<string, StoneColor> {
  return new Map(stones.map((stone) => [keyOf(stone), stone.color]));
}

function collectGroup(board: Map<string, StoneColor>, start: Point, size: number): {
  stones: Point[];
  liberties: Set<string>;
} {
  const color = board.get(keyOf(start));
  if (!color) return { stones: [], liberties: new Set() };
  const queue = [start];
  const seen = new Set<string>();
  const stones: Point[] = [];
  const liberties = new Set<string>();
  while (queue.length) {
    const point = queue.pop() as Point;
    const key = keyOf(point);
    if (seen.has(key)) continue;
    seen.add(key);
    stones.push(point);
    for (const neighbor of neighbors(point, size)) {
      const neighborColor = board.get(keyOf(neighbor));
      if (!neighborColor) liberties.add(keyOf(neighbor));
      else if (neighborColor === color && !seen.has(keyOf(neighbor))) queue.push(neighbor);
    }
  }
  return { stones, liberties };
}
