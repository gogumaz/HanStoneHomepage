import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import {
  OAuthComponentError,
  type OAuthAuthorizationRequest,
  type OAuthCodeExchange,
  type OAuthIdentity,
  type OAuthProvider,
  type OAuthProviderConfig,
  type OAuthProviderName,
} from "./oauth-provider.js";

type TokenResponse = { access_token?: string; id_token?: string; token_type?: string };

abstract class OAuth2Provider implements OAuthProvider {
  abstract readonly providerName: OAuthProviderName;
  protected readonly requestFetch: typeof fetch;

  constructor(protected readonly config: OAuthProviderConfig, requestFetch?: typeof fetch) {
    this.requestFetch = requestFetch ?? fetch;
  }

  abstract createAuthorizationUrl(request: OAuthAuthorizationRequest): URL;
  abstract exchangeCode(input: OAuthCodeExchange): Promise<OAuthIdentity>;

  protected authorizationUrl(endpoint: string, request: OAuthAuthorizationRequest, defaultScopes: string[]): URL {
    if (!request.state) throw new OAuthComponentError("INVALID_REQUEST", "OAuth state is required.");
    const url = new URL(endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("state", request.state);
    const scopes = request.scopes ?? this.config.scopes ?? defaultScopes;
    if (scopes.length) url.searchParams.set("scope", scopes.join(" "));
    if (request.codeChallenge) {
      url.searchParams.set("code_challenge", request.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
    }
    return url;
  }

  protected async exchangeToken(
    endpoint: string,
    input: OAuthCodeExchange,
    extraParameters: Record<string, string> = {},
  ): Promise<TokenResponse> {
    if (!input.code || !input.state) {
      throw new OAuthComponentError("INVALID_REQUEST", "OAuth code and state are required.");
    }
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      code: input.code,
      ...extraParameters,
    });
    if (input.codeVerifier) body.set("code_verifier", input.codeVerifier);
    const response = await this.request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }, "TOKEN_EXCHANGE_FAILED");
    const payload = await response.json() as TokenResponse;
    if (!payload.access_token) {
      throw new OAuthComponentError("TOKEN_EXCHANGE_FAILED", "OAuth token response is invalid.");
    }
    return payload;
  }

  protected async profile<T>(endpoint: string, accessToken: string): Promise<T> {
    const response = await this.request(endpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }, "PROFILE_REQUEST_FAILED");
    return response.json() as Promise<T>;
  }

  private async request(
    url: string,
    init: RequestInit,
    code: "TOKEN_EXCHANGE_FAILED" | "PROFILE_REQUEST_FAILED",
  ): Promise<Response> {
    try {
      const response = await this.requestFetch(url, init);
      if (!response.ok) throw new OAuthComponentError(code, "OAuth provider request failed.", response.status >= 500);
      return response;
    } catch (error) {
      if (error instanceof OAuthComponentError) throw error;
      throw new OAuthComponentError(code, "OAuth provider request failed.", true);
    }
  }

  protected identity(input: Omit<OAuthIdentity, "provider">): OAuthIdentity {
    if (
      !input.subject
      || !input.displayName
      || (input.email !== null && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.email.length > 254))
    ) {
      throw new OAuthComponentError("INVALID_IDENTITY", "OAuth identity response is invalid.");
    }
    return { provider: this.providerName, ...input };
  }
}

export class NaverOAuthProvider extends OAuth2Provider {
  readonly providerName = "naver" as const;

  createAuthorizationUrl(request: OAuthAuthorizationRequest): URL {
    return this.authorizationUrl(
      this.config.authorizationEndpoint ?? "https://nid.naver.com/oauth2.0/authorize",
      request,
      [],
    );
  }

  async exchangeCode(input: OAuthCodeExchange): Promise<OAuthIdentity> {
    const endpoint = this.config.tokenEndpoint ?? "https://nid.naver.com/oauth2.0/token";
    const token = await this.exchangeToken(endpoint, input, { state: input.state });
    const payload = await this.profile<{
      resultcode?: string;
      response?: { id?: string; email?: string; name?: string; nickname?: string };
    }>(this.config.profileEndpoint ?? "https://openapi.naver.com/v1/nid/me", token.access_token as string);
    const profile = payload.response;
    return this.identity({
      subject: profile?.id ?? "",
      email: profile?.email?.toLowerCase() ?? null,
      emailVerified: false,
      displayName: profile?.name || profile?.nickname || "네이버 사용자",
    });
  }
}

export class KakaoOAuthProvider extends OAuth2Provider {
  readonly providerName = "kakao" as const;

  createAuthorizationUrl(request: OAuthAuthorizationRequest): URL {
    return this.authorizationUrl(
      this.config.authorizationEndpoint ?? "https://kauth.kakao.com/oauth/authorize",
      request,
      ["profile_nickname", "account_email"],
    );
  }

  async exchangeCode(input: OAuthCodeExchange): Promise<OAuthIdentity> {
    const token = await this.exchangeToken(
      this.config.tokenEndpoint ?? "https://kauth.kakao.com/oauth/token",
      input,
    );
    const profile = await this.profile<{
      id?: number | string;
      properties?: { nickname?: string };
      kakao_account?: {
        email?: string;
        is_email_verified?: boolean;
        profile?: { nickname?: string };
      };
    }>(this.config.profileEndpoint ?? "https://kapi.kakao.com/v2/user/me", token.access_token as string);
    return this.identity({
      subject: profile.id === undefined ? "" : String(profile.id),
      email: profile.kakao_account?.email?.toLowerCase() ?? null,
      emailVerified: profile.kakao_account?.is_email_verified === true,
      displayName: profile.kakao_account?.profile?.nickname || profile.properties?.nickname || "카카오 사용자",
    });
  }
}

export class GoogleOAuthProvider extends OAuth2Provider {
  readonly providerName = "google" as const;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(config: OAuthProviderConfig, requestFetch?: typeof fetch) {
    super(config, requestFetch);
    this.jwks = createRemoteJWKSet(
      new URL(config.jwksUri ?? "https://www.googleapis.com/oauth2/v3/certs"),
      requestFetch ? { [customFetch]: requestFetch } : undefined,
    );
  }

  createAuthorizationUrl(request: OAuthAuthorizationRequest): URL {
    if (!request.nonce) throw new OAuthComponentError("INVALID_REQUEST", "Google OIDC nonce is required.");
    const url = this.authorizationUrl(
      this.config.authorizationEndpoint ?? "https://accounts.google.com/o/oauth2/v2/auth",
      request,
      ["openid", "email", "profile"],
    );
    url.searchParams.set("nonce", request.nonce);
    return url;
  }

  async exchangeCode(input: OAuthCodeExchange): Promise<OAuthIdentity> {
    if (!input.nonce) throw new OAuthComponentError("INVALID_REQUEST", "Google OIDC nonce is required.");
    const token = await this.exchangeToken(
      this.config.tokenEndpoint ?? "https://oauth2.googleapis.com/token",
      input,
    );
    if (!token.id_token) throw new OAuthComponentError("INVALID_IDENTITY", "Google ID token is missing.");
    try {
      const { payload } = await jwtVerify(token.id_token, this.jwks, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: this.config.clientId,
      });
      if (payload.nonce !== input.nonce) {
        throw new OAuthComponentError("INVALID_IDENTITY", "Google ID token nonce does not match.");
      }
      return this.identity({
        subject: payload.sub ?? "",
        email: typeof payload.email === "string" ? payload.email.toLowerCase() : null,
        emailVerified: payload.email_verified === true,
        displayName: typeof payload.name === "string" ? payload.name : "Google 사용자",
      });
    } catch (error) {
      if (error instanceof OAuthComponentError) throw error;
      throw new OAuthComponentError("INVALID_IDENTITY", "Google ID token verification failed.");
    }
  }
}
