import { useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';
import type { ErrorData } from 'hls.js';

type LessonVideoPlayerProps = {
  src: string;
  format: 'mp4' | 'hls';
  downloadBeforePlayback?: boolean;
};

export function LessonVideoPlayer({ src, format, downloadBeforePlayback = false }: LessonVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    setError(null);

    if (format === 'mp4') {
      if (!downloadBeforePlayback) {
        video.src = src;
        return () => {
          video.removeAttribute('src');
        };
      }
      const controller = new AbortController();
      let objectUrl: string | null = null;
      let disposed = false;
      setDownloading(true);
      void fetch(src, { credentials: 'include', signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error('VIDEO_DOWNLOAD_FAILED');
          const blob = await response.blob();
          if (!blob.size || !blob.type.toLowerCase().startsWith('video/mp4')) {
            throw new Error('VIDEO_DOWNLOAD_INVALID');
          }
          objectUrl = URL.createObjectURL(blob);
          video.src = objectUrl;
        })
        .catch((downloadError: unknown) => {
          if ((downloadError as Error).name !== 'AbortError') {
            setError('영상을 내려받지 못했습니다. 잠시 후 다시 시도해 주세요.');
          }
        })
        .finally(() => {
          if (!disposed) setDownloading(false);
        });
      return () => {
        disposed = true;
        controller.abort();
        video.removeAttribute('src');
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }

    let disposed = false;
    let hls: Hls | null = null;
    let removeHlsErrorListener: (() => void) | null = null;
    void import('hls.js/light').then(({ default: HlsPlayer, ErrorTypes, Events }) => {
      if (disposed) return;
      if (HlsPlayer.isSupported()) {
        hls = new HlsPlayer({ enableWorker: true });
        let networkRecoveries = 0;
        let mediaRecoveries = 0;
        const onError = (_event: typeof Events.ERROR, data: ErrorData) => {
          if (!data.fatal || !hls) return;
          if (data.type === ErrorTypes.NETWORK_ERROR && networkRecoveries < 1) {
            networkRecoveries += 1;
            hls.startLoad();
            return;
          }
          if (data.type === ErrorTypes.MEDIA_ERROR && mediaRecoveries < 1) {
            mediaRecoveries += 1;
            hls.recoverMediaError();
            return;
          }
          setError('HLS 영상을 재생하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        };
        hls.on(Events.ERROR, onError);
        removeHlsErrorListener = () => hls?.off(Events.ERROR, onError);
        hls.loadSource(src);
        hls.attachMedia(video);
        return;
      }
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
        return;
      }
      setError('이 브라우저는 HLS 재생을 지원하지 않습니다. 최신 브라우저를 이용해 주세요.');
    }).catch(() => {
      if (!disposed) setError('HLS 플레이어를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    });
    return () => {
      disposed = true;
      removeHlsErrorListener?.();
      hls?.destroy();
      video.removeAttribute('src');
    };
  }, [downloadBeforePlayback, format, src]);

  return (
    <>
      {downloading ? <p role="status">강의 영상을 내려받고 있습니다…</p> : null}
      <video
        ref={videoRef}
        className="lesson-video"
        controls
        controlsList="nodownload"
        preload="metadata"
      >
        브라우저가 영상 재생을 지원하지 않습니다.
      </video>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
    </>
  );
}
