export type OAuthProviderName = "naver" | "kakao" | "google";

export type OAuthAuthorizationRequest = {
  state: string;
  nonce?: string;
  codeChallenge?: string;
  scopes?: string[];
};

export type OAuthCodeExchange = {
  code: string;
  state: string;
  nonce?: string;
  codeVerifier?: string;
};

export type OAuthIdentity = {
  provider: OAuthProviderName;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
};

export interface OAuthProvider {
  readonly providerName: OAuthProviderName;
  createAuthorizationUrl(request: OAuthAuthorizationRequest): URL;
  exchangeCode(input: OAuthCodeExchange): Promise<OAuthIdentity>;
}

export class OAuthComponentError extends Error {
  constructor(
    public readonly code:
      | "PROVIDER_NOT_CONFIGURED"
      | "INVALID_REQUEST"
      | "TOKEN_EXCHANGE_FAILED"
      | "PROFILE_REQUEST_FAILED"
      | "INVALID_IDENTITY",
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "OAuthComponentError";
  }
}

export type OAuthProviderConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  profileEndpoint?: string;
  jwksUri?: string;
};

export type OAuthComponentOptions = {
  providers: Partial<Record<OAuthProviderName, OAuthProviderConfig>>;
  fetch?: typeof fetch;
};
