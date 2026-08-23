import { useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';
import type { ErrorData } from 'hls.js';

type LessonVideoPlayerProps = {
  src: string;
  format: 'mp4' | 'hls';
};

export function LessonVideoPlayer({ src, format }: LessonVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    setError(null);

    if (format === 'mp4') {
      video.src = src;
      return () => {
        video.removeAttribute('src');
      };
    }

    let disposed = false;
    let hls: Hls | null = null;
    let removeHlsErrorListener: (() => void) | null = null;
    void import('hls.js').then(({ default: HlsPlayer, ErrorTypes, Events }) => {
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
  }, [format, src]);

  return (
    <>
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
