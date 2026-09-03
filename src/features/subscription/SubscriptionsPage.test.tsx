import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionsPage } from './SubscriptionsPage';

const checkout = {
  orderId: 'sub_widget_test_001',
  orderName: '바둑대국 1개월 구독',
  amount: 10_000,
  currency: 'KRW',
  expiresAt: '2026-08-30T16:00:00.000Z',
  customerKey: 'student-widget',
  customerEmail: 'widget@example.com',
  customerName: '결제 학생',
};

function apiResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installApiMock() {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/me')) {
      return apiResponse({
        user: {
          id: 'student-widget',
          email: 'widget@example.com',
          emailVerified: true,
          displayName: '결제 학생',
          roles: ['student'],
        },
      });
    }
    if (url.endsWith('/subscription-plans')) {
      return apiResponse({
        items: [{ id: 'subscription-1m', label: '1개월', months: 1, price: 10_000, recommended: false }],
      });
    }
    if (url.endsWith('/me/subscriptions') || url.endsWith('/me/orders')) return apiResponse({ items: [] });
    if (url.endsWith('/orders/checkout') && init?.method === 'POST') return apiResponse(checkout, 201);
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/subscriptions']}>
        <SubscriptionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SubscriptionsPage Toss test widget', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete window.TossPayments;
    delete window.APP_CONFIG;
  });

  it('renders payment methods and agreement before enabling a test payment', async () => {
    installApiMock();
    window.APP_CONFIG = {
      apiBaseUrl: '/api/v1',
      tossPayments: {
        mode: 'test',
        clientKey: 'test_gck_subscription_12345678',
        paymentMethodVariantKey: 'TEST_METHODS',
        agreementVariantKey: 'TEST_AGREEMENT',
      },
    };

    let finishPaymentMethods!: () => void;
    const paymentMethodsPending = new Promise<void>((resolve) => {
      finishPaymentMethods = resolve;
    });
    const setAmount = vi.fn(async () => undefined);
    const renderPaymentMethods = vi.fn(async ({ selector }: { selector: string }) => {
      const target = document.querySelector(selector);
      const option = document.createElement('span');
      option.textContent = '테스트 카드 결제수단';
      target?.append(option);
      await paymentMethodsPending;
    });
    const renderAgreement = vi.fn(async ({ selector }: { selector: string }) => {
      const target = document.querySelector(selector);
      const agreement = document.createElement('span');
      agreement.textContent = '테스트 결제 약관';
      target?.append(agreement);
    });
    const requestPayment = vi.fn(async () => undefined);
    const widgets = vi.fn(() => ({ setAmount, renderPaymentMethods, renderAgreement, requestPayment }));
    window.TossPayments = Object.assign(vi.fn(() => ({ widgets })), { ANONYMOUS: 'ANONYMOUS' });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '결제하기' }));

    const preparingButton = await screen.findByRole('button', { name: '결제위젯 준비 중…' });
    expect(preparingButton).toBeDisabled();
    expect(await screen.findByText('테스트 카드 결제수단')).toBeInTheDocument();
    expect(screen.getByText('테스트 결제 약관')).toBeInTheDocument();
    expect(setAmount).toHaveBeenCalledWith({ currency: 'KRW', value: 10_000 });
    expect(renderPaymentMethods).toHaveBeenCalledWith({ selector: '#subscription-payment-method', variantKey: 'TEST_METHODS' });
    expect(renderAgreement).toHaveBeenCalledWith({ selector: '#subscription-agreement', variantKey: 'TEST_AGREEMENT' });

    finishPaymentMethods();
    const paymentButton = await screen.findByRole('button', { name: '토스로 10,000원 결제' });
    expect(paymentButton).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('테스트 결제입니다. 실제 금액은 청구되지 않습니다.');

    fireEvent.click(paymentButton);
    await waitFor(() => expect(requestPayment).toHaveBeenCalledWith(expect.objectContaining({
      orderId: checkout.orderId,
      orderName: checkout.orderName,
      customerEmail: checkout.customerEmail,
    })));
  });

  it('keeps payment disabled and explains a widget rendering failure', async () => {
    installApiMock();
    window.APP_CONFIG = {
      apiBaseUrl: '/api/v1',
      tossPayments: { mode: 'test', clientKey: 'test_gck_subscription_12345678' },
    };
    const widgets = vi.fn(() => ({
      setAmount: vi.fn(async () => undefined),
      renderPaymentMethods: vi.fn(async () => { throw new Error('widget failed'); }),
      renderAgreement: vi.fn(async () => undefined),
      requestPayment: vi.fn(async () => undefined),
    }));
    window.TossPayments = Object.assign(vi.fn(() => ({ widgets })), { ANONYMOUS: 'ANONYMOUS' });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '결제하기' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      '결제위젯을 표시하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.',
    );
    expect(screen.getByRole('button', { name: '결제위젯 준비 중…' })).toBeDisabled();
  });
});
