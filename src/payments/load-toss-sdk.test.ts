import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Toss Payments SDK lazy loader', () => {
  afterEach(() => {
    document.querySelectorAll('script[data-toss-payments-sdk]').forEach((script) => script.remove());
    delete window.TossPayments;
    vi.resetModules();
  });

  it('loads the SDK only on demand and deduplicates concurrent requests', async () => {
    const { loadTossPaymentsSdk } = await import('./load-toss-sdk');

    expect(document.querySelector('script[src="https://js.tosspayments.com/v2/standard"]')).toBeNull();
    const first = loadTossPaymentsSdk();
    const second = loadTossPaymentsSdk();
    const script = document.querySelector<HTMLScriptElement>('script[data-toss-payments-sdk="true"]');

    expect(script).not.toBeNull();
    expect(script?.async).toBe(true);
    expect(document.querySelectorAll('script[data-toss-payments-sdk]')).toHaveLength(1);

    const factory = Object.assign(vi.fn(), { ANONYMOUS: 'ANONYMOUS' }) as NonNullable<Window['TossPayments']>;
    window.TossPayments = factory;
    script?.dispatchEvent(new Event('load'));

    await expect(first).resolves.toBe(factory);
    await expect(second).resolves.toBe(factory);
    await expect(loadTossPaymentsSdk()).resolves.toBe(factory);
    expect(document.querySelectorAll('script[data-toss-payments-sdk]')).toHaveLength(1);
  });

  it('keeps the payment SDK out of every initial HTML entrypoint', () => {
    for (const entrypoint of ['index.html', 'lecture.html', 'app.html']) {
      const html = readFileSync(resolve(process.cwd(), entrypoint), 'utf8');
      expect(html, entrypoint).not.toContain('<script src="https://js.tosspayments.com/v2/standard"');
    }
  });

  it('allows a retry after a network failure', async () => {
    const { loadTossPaymentsSdk } = await import('./load-toss-sdk');
    const first = loadTossPaymentsSdk();
    document.querySelector<HTMLScriptElement>('script[data-toss-payments-sdk="true"]')
      ?.dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow('TOSS_PAYMENTS_SDK_LOAD_FAILED');

    document.querySelector('script[data-toss-payments-sdk]')?.remove();
    const retry = loadTossPaymentsSdk();
    expect(document.querySelectorAll('script[data-toss-payments-sdk]')).toHaveLength(1);
    const factory = vi.fn() as unknown as NonNullable<Window['TossPayments']>;
    window.TossPayments = factory;
    document.querySelector<HTMLScriptElement>('script[data-toss-payments-sdk="true"]')
      ?.dispatchEvent(new Event('load'));
    await expect(retry).resolves.toBe(factory);
  });
});
