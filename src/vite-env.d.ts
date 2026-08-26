/// <reference types="vite/client" />

type TossPaymentWidgets = {
  setAmount(input: { currency: 'KRW'; value: number }): Promise<void>;
  renderPaymentMethods(input: { selector: string; variantKey: string }): Promise<void>;
  renderAgreement(input: { selector: string; variantKey: string }): Promise<void>;
  requestPayment(input: Record<string, unknown>): Promise<void>;
};

interface Window {
  APP_CONFIG?: {
    apiBaseUrl?: string;
    oauthEnabled?: boolean;
    oauthProviders?: Array<'naver' | 'kakao' | 'google'>;
    tossPayments?: {
      mode?: 'test' | 'live';
      clientKey?: string;
      paymentMethodVariantKey?: string;
      agreementVariantKey?: string;
    };
  };
  TossPayments?: ((clientKey: string) => { widgets(input: { customerKey: string }): TossPaymentWidgets }) & {
    ANONYMOUS?: string;
  };
}
