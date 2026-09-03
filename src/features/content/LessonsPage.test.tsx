import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LessonsPage } from './LessonsPage';

const apiMocks = vi.hoisted(() => ({
  getLessonThumbnail: vi.fn(),
  listEraLessons: vi.fn(),
  listEras: vi.fn(),
  listSubscriptionPlans: vi.fn(),
}));

vi.mock('./api', () => apiMocks);

const era = {
  id: 'PRE',
  order: 1,
  name: '선사시대',
  theme: '주변을 먼저 살펴요',
  description: '첫 번째 역사 여행입니다.',
  status: 'available' as const,
  completedLessons: 0,
  totalLessons: 1,
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/lessons']}>
        <LessonsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LessonsPage network recovery', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.listSubscriptionPlans.mockResolvedValue({ items: [] });
    apiMocks.listEraLessons.mockResolvedValue({ era, items: [] });
    apiMocks.getLessonThumbnail.mockResolvedValue(null);
  });

  it('renders the page shell before a slow era request finishes', async () => {
    let resolveEras!: (eras: typeof era[]) => void;
    apiMocks.listEras.mockReturnValue(new Promise((resolve) => {
      resolveEras = resolve;
    }));

    renderPage();

    expect(screen.getByRole('heading', { name: '시대별 강의 여행' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('시대 목록을 불러오고 있습니다.');

    await act(async () => resolveEras([era]));
    expect(await screen.findByRole('navigation', { name: '시대 선택' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '선사시대' })).toBeInTheDocument();
  });

  it('shows a network-safe error and recovers after a manual retry', async () => {
    apiMocks.listEras
      .mockRejectedValueOnce(new TypeError('network endpoint with secret'))
      .mockResolvedValueOnce([era]);

    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('네트워크 연결이 불안정합니다.');
    expect(alert).not.toHaveTextContent('secret');
    fireEvent.click(screen.getByRole('button', { name: '강의 목록 다시 불러오기' }));

    expect(await screen.findByRole('navigation', { name: '시대 선택' })).toBeInTheDocument();
    expect(apiMocks.listEras).toHaveBeenCalledTimes(2);
  });

  it('keeps lesson content independent when subscription plans fail', async () => {
    apiMocks.listEras.mockResolvedValue([era]);
    apiMocks.listSubscriptionPlans.mockRejectedValueOnce(new TypeError('offline'));

    renderPage();

    expect(await screen.findByRole('heading', { name: '선사시대' })).toBeInTheDocument();
    expect(await screen.findByText('강의 목록은 계속 이용할 수 있습니다.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '플랜 다시 불러오기' })).toBeInTheDocument();
  });

  it('loads lesson-card thumbnails lazily without losing their accessible name', async () => {
    apiMocks.listEras.mockResolvedValue([era]);
    apiMocks.listEraLessons.mockResolvedValue({
      era,
      items: [{
        id: 'PRE-01',
        era: { id: era.id, name: era.name },
        order: 1,
        level: '입문',
        course: '선사시대',
        title: '주먹도끼에서 배운 첫 수',
        summary: '주변을 살피는 법을 배웁니다.',
        instructor: '김선생',
        difficulty: '쉬움',
        durationMinutes: 5,
        isFreeSample: true,
        hasThumbnail: true,
        access: 'free_sample',
        publishedAt: '2026-08-28T00:00:00.000Z',
        steps: [],
      }],
    });
    apiMocks.getLessonThumbnail.mockResolvedValue({
      lessonId: 'PRE-01',
      url: 'https://assets.example.test/PRE-01.webp',
      expiresAt: '2026-08-28T00:05:00.000Z',
    });

    renderPage();

    const thumbnail = await screen.findByRole('img', { name: '주먹도끼에서 배운 첫 수 강의 썸네일' });
    expect(thumbnail).toHaveAttribute('loading', 'lazy');
    expect(thumbnail).toHaveAttribute('decoding', 'async');
  });
});
