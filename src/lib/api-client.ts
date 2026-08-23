type ApiEnvelope<T> = { data: T };
type ApiErrorEnvelope = {
  error?: { code?: string; message?: string; requestId?: string };
};

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code = 'API_ERROR',
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T> & ApiErrorEnvelope;
  if (!response.ok) {
    throw new ApiClientError(
      payload.error?.message || '요청을 처리하지 못했습니다.',
      response.status,
      payload.error?.code,
      payload.error?.requestId,
    );
  }
  return payload.data;
}

export async function apiDownload(path: string): Promise<{ blob: Blob; filename: string | null }> {
  const response = await fetch(`${apiBaseUrl}${path}`, { credentials: 'include' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as ApiErrorEnvelope;
    throw new ApiClientError(
      payload.error?.message || '파일을 내려받지 못했습니다.',
      response.status,
      payload.error?.code,
      payload.error?.requestId,
    );
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const encodedFilename = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const quotedFilename = disposition.match(/filename="([^"]+)"/i)?.[1];
  const filename = encodedFilename
    ? decodeURIComponent(encodedFilename)
    : quotedFilename ?? null;
  return { blob: await response.blob(), filename };
}
