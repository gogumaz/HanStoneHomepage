import { Inject, Injectable } from "@nestjs/common";
import {
  GoogleOAuthProvider,
  KakaoOAuthProvider,
  NaverOAuthProvider,
} from "./oauth-providers.js";
import {
  OAuthComponentError,
  type OAuthCodeExchange,
  type OAuthComponentOptions,
  type OAuthIdentity,
  type OAuthProvider,
  type OAuthProviderName,
  type OAuthAuthorizationRequest,
} from "./oauth-provider.js";

export const OAUTH_COMPONENT_OPTIONS = Symbol("OAUTH_COMPONENT_OPTIONS");

@Injectable()
export class OAuthClient {
  private readonly providers = new Map<OAuthProviderName, OAuthProvider>();

  constructor(@Inject(OAUTH_COMPONENT_OPTIONS) options: OAuthComponentOptions) {
    const factories = {
      naver: NaverOAuthProvider,
      kakao: KakaoOAuthProvider,
      google: GoogleOAuthProvider,
    } as const;
    for (const providerName of Object.keys(options.providers) as OAuthProviderName[]) {
      const config = options.providers[providerName];
      if (config) this.providers.set(providerName, new factories[providerName](config, options.fetch));
    }
  }

  availableProviders(): OAuthProviderName[] {
    return [...this.providers.keys()];
  }

  createAuthorizationUrl(provider: OAuthProviderName, request: OAuthAuthorizationRequest): URL {
    return this.get(provider).createAuthorizationUrl(request);
  }

  exchangeCode(provider: OAuthProviderName, input: OAuthCodeExchange): Promise<OAuthIdentity> {
    return this.get(provider).exchangeCode(input);
  }

  private get(provider: OAuthProviderName): OAuthProvider {
    const adapter = this.providers.get(provider);
    if (!adapter) {
      throw new OAuthComponentError("PROVIDER_NOT_CONFIGURED", `OAuth provider is not configured: ${provider}`);
    }
    return adapter;
  }
}
