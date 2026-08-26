export type TossPaymentMode = 'test' | 'live';

export type TossBrowserConfig = {
  mode: TossPaymentMode;
  clientKey: string;
  paymentMethodVariantKey: string;
  agreementVariantKey: string;
};

type TossBrowserConfigInput = {
  mode?: string;
  clientKey?: string;
  paymentMethodVariantKey?: string;
  agreementVariantKey?: string;
} | null | undefined;

type ConfirmationStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class TossBrowserConfigurationError extends Error {
  constructor(public readonly code: 'TOSS_CLIENT_KEY_INVALID' | 'TOSS_CLIENT_KEY_MODE_MISMATCH') {
    super(code);
    this.name = 'TossBrowserConfigurationError';
  }
}

const ORDER_ID = /^[A-Za-z0-9_-]{6,64}$/;
const CONFIRMATION_ID = /^toss_confirm_[A-Za-z0-9_-]{16,100}$/;

export function resolveTossBrowserConfig(input: TossBrowserConfigInput): TossBrowserConfig | null {
  const clientKey = input?.clientKey?.trim() ?? '';
  if (!clientKey) return null;
  const inferredMode = clientKey.startsWith('test_') ? 'test' : clientKey.startsWith('live_') ? 'live' : null;
  if (!inferredMode || !/^(?:test|live)_gck_[A-Za-z0-9_-]{8,}$/.test(clientKey)) {
    throw new TossBrowserConfigurationError('TOSS_CLIENT_KEY_INVALID');
  }
  const mode = input?.mode?.trim() || inferredMode;
  if (mode !== 'test' && mode !== 'live') {
    throw new TossBrowserConfigurationError('TOSS_CLIENT_KEY_INVALID');
  }
  if (mode !== inferredMode) {
    throw new TossBrowserConfigurationError('TOSS_CLIENT_KEY_MODE_MISMATCH');
  }
  return Object.freeze({
    mode,
    clientKey,
    paymentMethodVariantKey: input?.paymentMethodVariantKey?.trim() || 'DEFAULT',
    agreementVariantKey: input?.agreementVariantKey?.trim() || 'AGREEMENT',
  });
}

function newConfirmationId(): string {
  if (typeof crypto.randomUUID === 'function') return `toss_confirm_${crypto.randomUUID()}`;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `toss_confirm_${[...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

export function stableTossConfirmationId(
  orderId: string,
  storage: ConfirmationStorage = sessionStorage,
  createId: () => string = newConfirmationId,
): string {
  if (!ORDER_ID.test(orderId)) throw new Error('TOSS_ORDER_ID_INVALID');
  const key = `baduk-toss-confirm:${orderId}`;
  try {
    const stored = storage.getItem(key);
    if (stored && CONFIRMATION_ID.test(stored)) return stored;
    const created = createId();
    if (!CONFIRMATION_ID.test(created)) throw new Error('TOSS_CONFIRMATION_ID_INVALID');
    storage.setItem(key, created);
    return created;
  } catch (error) {
    if (error instanceof Error && error.message === 'TOSS_CONFIRMATION_ID_INVALID') throw error;
    const created = createId();
    if (!CONFIRMATION_ID.test(created)) throw new Error('TOSS_CONFIRMATION_ID_INVALID');
    return created;
  }
}

export function clearTossConfirmationId(
  orderId: string,
  storage: ConfirmationStorage = sessionStorage,
): void {
  if (!ORDER_ID.test(orderId)) return;
  try {
    storage.removeItem(`baduk-toss-confirm:${orderId}`);
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
}

export function tossPaymentReadyMessage(mode: TossPaymentMode): string {
  return mode === 'test'
    ? '테스트 결제입니다. 실제 금액은 청구되지 않습니다. 결제수단을 선택한 뒤 결제 버튼을 눌러 주세요.'
    : '결제수단을 선택한 뒤 결제 버튼을 눌러 주세요.';
}
