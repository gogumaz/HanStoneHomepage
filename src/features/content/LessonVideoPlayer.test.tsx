import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LessonVideoPlayer } from './LessonVideoPlayer';

const hlsState = vi.hoisted(() => ({
  supported: true,
  instances: [] as Array<{
    loadSource: ReturnType<typeof vi.fn>;
    attachMedia: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('hls.js/light', () => {
  class MockHls {
    static isSupported() { return hlsState.supported; }
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    startLoad = vi.fn();
    recoverMediaError = vi.fn();
    on = vi.fn();
    off = vi.fn();
    constructor() { hlsState.instances.push(this); }
  }
  return {
    default: MockHls,
    ErrorTypes: { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' },
    Events: { ERROR: 'hlsError' },
  };
});

describe('LessonVideoPlayer', () => {
  beforeEach(() => {
    hlsState.supported = true;
    hlsState.instances.length = 0;
  });

  afterEach(() => cleanup());

  it('assigns an MP4 URL directly to the video element', () => {
    const { container } = render(<LessonVideoPlayer format="mp4" src="https://media.example.test/video.mp4" />);
    expect(container.querySelector('video')).toHaveAttribute('src', 'https://media.example.test/video.mp4');
    expect(hlsState.instances).toHaveLength(0);
  });

  it('attaches HLS.js and destroys it when the player unmounts', async () => {
    const result = render(<LessonVideoPlayer format="hls" src="/api/v1/lessons/PRE-01/hls-manifest" />);
    await waitFor(() => expect(hlsState.instances).toHaveLength(1));
    const instance = hlsState.instances[0];
    expect(instance?.loadSource).toHaveBeenCalledWith('/api/v1/lessons/PRE-01/hls-manifest');
    expect(instance?.attachMedia).toHaveBeenCalledWith(result.container.querySelector('video'));
    result.unmount();
    expect(instance?.destroy).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
