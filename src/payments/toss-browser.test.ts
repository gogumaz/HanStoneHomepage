import { describe, expect, it } from 'vitest';
import {
  clearTossConfirmationId,
  resolveTossBrowserConfig,
  stableTossConfirmationId,
  tossPaymentReadyMessage,
} from './toss-browser';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('Toss browser payment component', () => {
  it('accepts only the v2 widget key matching the declared test or live mode', () => {
    expect(resolveTossBrowserConfig({ mode: 'test', clientKey: 'test_gck_example_12345678' })).toMatchObject({
      mode: 'test', paymentMethodVariantKey: 'DEFAULT', agreementVariantKey: 'AGREEMENT',
    });
    expect(() => resolveTossBrowserConfig({ mode: 'live', clientKey: 'test_gck_example_12345678' }))
      .toThrowError(expect.objectContaining({ code: 'TOSS_CLIENT_KEY_MODE_MISMATCH' }));
    expect(() => resolveTossBrowserConfig({ mode: 'test', clientKey: 'test_ck_legacy_12345678' }))
      .toThrowError(expect.objectContaining({ code: 'TOSS_CLIENT_KEY_INVALID' }));
  });

  it('reuses one confirmation id across retries and clears it only after success', () => {
    const storage = memoryStorage();
    const orderId = 'sub_1234567890';
    const ids = ['toss_confirm_1234567890abcdef', 'toss_confirm_fedcba0987654321'];
    const createId = () => ids.shift()!;

    expect(stableTossConfirmationId(orderId, storage, createId)).toBe('toss_confirm_1234567890abcdef');
    expect(stableTossConfirmationId(orderId, storage, createId)).toBe('toss_confirm_1234567890abcdef');
    clearTossConfirmationId(orderId, storage);
    expect(stableTossConfirmationId(orderId, storage, createId)).toBe('toss_confirm_fedcba0987654321');
  });

  it('labels test payments without exposing key material', () => {
    expect(tossPaymentReadyMessage('test')).toContain('실제 금액은 청구되지 않습니다');
    expect(tossPaymentReadyMessage('live')).not.toContain('테스트');
  });
});
