import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { RouteErrorBoundary, RouteLoading, StackStatus } from './App';

describe('React stack entry', () => {
  it('announces route loading as a busy status', () => {
    render(<RouteLoading />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('화면을 불러오고 있습니다…')).toBeInTheDocument();
  });

  it('shows a recoverable alert when a route chunk fails', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const BrokenRoute = () => {
      throw new Error('chunk load failed with internal detail');
    };

    render(
      <RouteErrorBoundary>
        <BrokenRoute />
      </RouteErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('화면을 불러오지 못했습니다.');
    expect(screen.getByRole('button', { name: '새로고침' })).toBeInTheDocument();
    expect(screen.queryByText(/internal detail/)).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('shows the selected frontend stack', () => {
    render(
      <MemoryRouter>
        <StackStatus navigation={<nav aria-label="테스트 메뉴" />} />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'React 전환 환경이 준비되었습니다.' })).toBeInTheDocument();
    expect(screen.getByText('React + TypeScript')).toBeInTheDocument();
    expect(screen.getByText('TanStack Query')).toBeInTheDocument();
  });
});
