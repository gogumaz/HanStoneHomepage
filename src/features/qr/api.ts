import { apiRequest } from '../../lib/api-client';

export type QrResolution = {
  status: 'active' | 'expired' | 'used' | 'disabled' | 'unavailable';
  expiresAt: string | null;
  remainingClaims: number | null;
  target: null | {
    type: 'lesson';
    lesson: { id: string; title: string };
    path: string;
  };
};

export function resolveQrCode(code: string) {
  return apiRequest<QrResolution>(`/qr/${encodeURIComponent(code)}`);
}
