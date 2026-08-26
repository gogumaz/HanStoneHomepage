import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { BoardState, Point, Stone, StoneColor } from './api';

type Props = {
  board: BoardState;
  pendingPoint?: Point | null;
  pendingColor?: StoneColor;
  hintPoint?: Point | null;
  disabled?: boolean;
  showCoordinates?: boolean;
  onPointSelect?: (point: Point) => void;
  ariaLabel?: string;
};

const columns = 'ABCDEFGHJKLMNOPQRST';

export function GoBoard({
  board,
  pendingPoint,
  pendingColor = 'black',
  hintPoint,
  disabled = false,
  showCoordinates = true,
  onPointSelect,
  ariaLabel = `${board.size}줄 바둑판`,
}: Props) {
  const touchGesture = useRef({ pointerId: -1, startX: 0, startY: 0, moved: false });
  const padding = 36;
  const field = 568;
  const step = field / (board.size - 1);
  const coordinate = (value: number) => padding + value * step;
  const points = Array.from({ length: board.size * board.size }, (_, index) => ({
    x: index % board.size,
    y: Math.floor(index / board.size),
  }));
  const stars = starPoints(board.size);

  function handleKey(event: KeyboardEvent<SVGCircleElement>, point: Point) {
    const delta = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (delta) {
      event.preventDefault();
      const x = Math.max(0, Math.min(board.size - 1, point.x + delta[0]));
      const y = Math.max(0, Math.min(board.size - 1, point.y + delta[1]));
      event.currentTarget.ownerSVGElement
        ?.querySelector<SVGCircleElement>(`[data-board-point="${x}:${y}"]`)
        ?.focus();
    } else if ((event.key === 'Enter' || event.key === ' ') && !disabled) {
      event.preventDefault();
      onPointSelect?.(point);
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'touch') {
      touchGesture.current.pointerId = -1;
      touchGesture.current.moved = false;
      return;
    }
    touchGesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const gesture = touchGesture.current;
    if (event.pointerType !== 'touch' || gesture.pointerId !== event.pointerId || gesture.moved) return;
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >= 10) {
      gesture.moved = true;
    }
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'touch' || touchGesture.current.pointerId !== event.pointerId) return;
    const pointerId = event.pointerId;
    window.setTimeout(() => {
      if (touchGesture.current.pointerId !== pointerId) return;
      touchGesture.current.pointerId = -1;
      touchGesture.current.moved = false;
    }, 0);
  }

  function selectPoint(point: Point) {
    const wasScrollGesture = touchGesture.current.moved;
    touchGesture.current.pointerId = -1;
    touchGesture.current.moved = false;
    if (!disabled && !wasScrollGesture) onPointSelect?.(point);
  }

  return (
    <div
      className={`go-board-scroll board-${board.size}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { touchGesture.current.pointerId = -1; touchGesture.current.moved = false; }}
    >
      <svg className="go-board" viewBox="0 0 640 640" role="grid" aria-label={ariaLabel}>
        <rect x="0" y="0" width="640" height="640" rx="18" className="board-wood" />
        {Array.from({ length: board.size }, (_, index) => (
          <g key={`line-${index}`} className="board-lines">
            <line x1={padding} y1={coordinate(index)} x2={padding + field} y2={coordinate(index)} />
            <line x1={coordinate(index)} y1={padding} x2={coordinate(index)} y2={padding + field} />
          </g>
        ))}
        {stars.map((point) => <circle key={`star-${point.x}-${point.y}`} cx={coordinate(point.x)} cy={coordinate(point.y)} r="5" className="board-star" />)}
        {showCoordinates ? Array.from({ length: board.size }, (_, index) => (
          <g key={`coordinate-${index}`} className="board-coordinate" aria-hidden="true">
            <text x={coordinate(index)} y="22">{columns[index]}</text>
            <text x="17" y={coordinate(index) + 4}>{board.size - index}</text>
          </g>
        )) : null}
        {hintPoint ? <circle cx={coordinate(hintPoint.x)} cy={coordinate(hintPoint.y)} r={Math.max(12, step * 0.32)} className="hint-point" aria-hidden="true" /> : null}
        {board.stones.map((stone) => (
          <StoneCircle key={`${stone.x}:${stone.y}`} stone={stone} x={coordinate(stone.x)} y={coordinate(stone.y)} radius={Math.min(24, step * 0.43)} last={samePoint(board.lastMove, stone)} />
        ))}
        {pendingPoint ? (
          <circle
            cx={coordinate(pendingPoint.x)}
            cy={coordinate(pendingPoint.y)}
            r={Math.min(24, step * 0.43)}
            className={`stone pending ${pendingColor}`}
            aria-hidden="true"
          />
        ) : null}
        {points.map((point) => (
          <circle
            key={`hit-${point.x}-${point.y}`}
            cx={coordinate(point.x)}
            cy={coordinate(point.y)}
            r={Math.max(13, step * 0.43)}
            className="board-hit-area"
            role="button"
            tabIndex={disabled ? -1 : 0}
            data-board-point={`${point.x}:${point.y}`}
            aria-label={`${columns[point.x]}${board.size - point.y} 교차점`}
            aria-disabled={disabled}
            onClick={() => selectPoint(point)}
            onKeyDown={(event) => handleKey(event, point)}
          />
        ))}
      </svg>
    </div>
  );
}

function StoneCircle({ stone, x, y, radius, last }: { stone: Stone; x: number; y: number; radius: number; last: boolean }) {
  return (
    <g aria-hidden="true">
      <circle cx={x} cy={y} r={radius} className={`stone ${stone.color}`} />
      {last ? <circle cx={x} cy={y} r={Math.max(3, radius * 0.18)} className="last-move-marker" /> : null}
    </g>
  );
}

function starPoints(size: 9 | 13 | 19): Point[] {
  const axes = size === 9 ? [2, 4, 6] : size === 13 ? [3, 6, 9] : [3, 9, 15];
  return axes.flatMap((x) => axes.map((y) => ({ x, y })));
}

function samePoint(left: Point | null, right: Point): boolean {
  return Boolean(left && left.x === right.x && left.y === right.y);
}
