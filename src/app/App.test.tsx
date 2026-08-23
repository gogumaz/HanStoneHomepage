import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { StackStatus } from './App';

describe('React stack entry', () => {
  it('shows the selected frontend stack', () => {
    render(
      <MemoryRouter>
        <StackStatus />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'React 전환 환경이 준비되었습니다.' })).toBeInTheDocument();
    expect(screen.getByText('React + TypeScript')).toBeInTheDocument();
    expect(screen.getByText('TanStack Query')).toBeInTheDocument();
  });
});
