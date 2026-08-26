import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoBoard } from './GoBoard';

afterEach(cleanup);

describe('GoBoard', () => {
  it.each([9, 13, 19] as const)('renders every selectable intersection on a %i-line board', (size) => {
    const onPointSelect = vi.fn();
    render(<GoBoard board={{ size, stones: [], previousPositionHash: null, lastMove: null }} onPointSelect={onPointSelect} />);

    const intersections = screen.getAllByRole('button');
    expect(intersections).toHaveLength(size * size);
    fireEvent.click(screen.getByRole('button', { name: `A${size} 교차점` }));
    expect(onPointSelect).toHaveBeenCalledWith({ x: 0, y: 0 });
  });

  it('moves keyboard focus between intersections and selects with Enter', () => {
    const onPointSelect = vi.fn();
    render(<GoBoard board={{ size: 9, stones: [], previousPositionHash: null, lastMove: null }} onPointSelect={onPointSelect} />);
    const first = screen.getByRole('button', { name: 'A9 교차점' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'B9 교차점' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'B9 교차점' }), { key: 'Enter' });
    expect(onPointSelect).toHaveBeenCalledWith({ x: 1, y: 0 });
  });

  it('distinguishes a mobile scroll gesture from a tap on a 19-line board', () => {
    const onPointSelect = vi.fn();
    const { container } = render(<GoBoard board={{ size: 19, stones: [], previousPositionHash: null, lastMove: null }} onPointSelect={onPointSelect} />);
    const scroller = container.querySelector('.go-board-scroll');
    if (!scroller) throw new Error('board scroller is missing');
    const target = screen.getByRole('button', { name: 'K10 교차점' });

    fireEvent.pointerDown(scroller, { pointerId: 1, pointerType: 'touch', clientX: 220, clientY: 220 });
    fireEvent.pointerMove(scroller, { pointerId: 1, pointerType: 'touch', clientX: 170, clientY: 220 });
    fireEvent.pointerUp(scroller, { pointerId: 1, pointerType: 'touch', clientX: 170, clientY: 220 });
    fireEvent.click(target);
    expect(onPointSelect).not.toHaveBeenCalled();

    fireEvent.pointerDown(scroller, { pointerId: 2, pointerType: 'touch', clientX: 170, clientY: 220 });
    fireEvent.pointerUp(scroller, { pointerId: 2, pointerType: 'touch', clientX: 170, clientY: 220 });
    fireEvent.click(target);
    expect(onPointSelect).toHaveBeenCalledWith({ x: 9, y: 9 });
  });
});
