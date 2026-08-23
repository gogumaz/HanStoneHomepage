import type { OAuthComponentOptions, OAuthProviderConfig, OAuthProviderName } from "../components/oauth/index.js";

type ProviderEnvironment = {
  prefix: string;
  clientId: string;
  clientSecret: string;
};

const PROVIDERS: Record<OAuthProviderName, ProviderEnvironment> = {
  naver: { prefix: "NAVER", clientId: "CLIENT_ID", clientSecret: "CLIENT_SECRET" },
  kakao: { prefix: "KAKAO", clientId: "REST_API_KEY", clientSecret: "CLIENT_SECRET" },
  google: { prefix: "GOOGLE", clientId: "CLIENT_ID", clientSecret: "CLIENT_SECRET" },
};

export function loadOAuthComponentOptions(env: NodeJS.ProcessEnv = process.env): OAuthComponentOptions {
  const providers: OAuthComponentOptions["providers"] = {};
  for (const providerName of Object.keys(PROVIDERS) as OAuthProviderName[]) {
    const definition = PROVIDERS[providerName];
    const clientId = env[`${definition.prefix}_${definition.clientId}`]?.trim() || "";
    const clientSecret = env[`${definition.prefix}_${definition.clientSecret}`]?.trim() || "";
    const redirectUri = env[`${definition.prefix}_REDIRECT_URI`]?.trim() || "";
    if (!clientId && !clientSecret && !redirectUri) continue;
    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error(`${definition.prefix} OAuth 설정에는 client ID, secret, redirect URI가 모두 필요합니다.`);
    }
    let parsedRedirect: URL;
    try {
      parsedRedirect = new URL(redirectUri);
    } catch {
      throw new Error(`${definition.prefix}_REDIRECT_URI는 올바른 URL이어야 합니다.`);
    }
    if (parsedRedirect.protocol !== "https:" && parsedRedirect.hostname !== "127.0.0.1" && parsedRedirect.hostname !== "localhost") {
      throw new Error(`${definition.prefix}_REDIRECT_URI는 HTTPS 또는 로컬 개발 주소여야 합니다.`);
    }
    providers[providerName] = { clientId, clientSecret, redirectUri } satisfies OAuthProviderConfig;
  }
  return { providers };
}
