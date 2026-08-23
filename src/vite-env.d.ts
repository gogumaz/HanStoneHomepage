/// <reference types="vite/client" />

type PortOneV1Response = {
  imp_uid?: string;
  merchant_uid?: string;
  error_msg?: string;
};

interface Window {
  APP_CONFIG?: {
    apiBaseUrl?: string;
    oauthEnabled?: boolean;
    oauthProviders?: Array<'naver' | 'kakao' | 'google'>;
    portoneV1?: {
      userCode?: string;
      channelKey?: string;
      pgProvider?: string;
      mid?: string;
    };
  };
  IMP?: {
    init(userCode: string): void;
    request_pay(
      request: Record<string, unknown>,
      callback: (response: PortOneV1Response) => void,
    ): void;
  };
}
