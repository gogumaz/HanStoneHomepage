import { describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { OAuthClient } from "./oauth-client.js";
import { OAuthComponentError } from "./oauth-provider.js";

const baseConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://app.example.test/oauth/callback",
};

describe("OAuthClient", () => {
  it("creates state and PKCE-bound authorization URLs", () => {
    const client = new OAuthClient({
      providers: { naver: baseConfig, kakao: baseConfig, google: baseConfig },
    });
    const naver = client.createAuthorizationUrl("naver", {
      state: "state-value",
      codeChallenge: "pkce-challenge",
    });
    expect(naver.origin + naver.pathname).toBe("https://nid.naver.com/oauth2.0/authorize");
    expect(naver.searchParams.get("response_type")).toBe("code");
    expect(naver.searchParams.get("client_id")).toBe("client-id");
    expect(naver.searchParams.get("redirect_uri")).toBe("https://app.example.test/oauth/callback");
    expect(naver.searchParams.get("state")).toBe("state-value");
    expect(naver.searchParams.get("code_challenge")).toBe("pkce-challenge");
    expect(naver.searchParams.get("code_challenge_method")).toBe("S256");

    const kakao = client.createAuthorizationUrl("kakao", {
      state: "kakao-state",
      codeChallenge: "kakao-pkce-challenge",
    });
    expect(kakao.origin + kakao.pathname).toBe("https://kauth.kakao.com/oauth/authorize");
    expect(kakao.searchParams.get("response_type")).toBe("code");
    expect(kakao.searchParams.get("client_id")).toBe("client-id");
    expect(kakao.searchParams.get("redirect_uri")).toBe("https://app.example.test/oauth/callback");
    expect(kakao.searchParams.get("state")).toBe("kakao-state");
    expect(kakao.searchParams.get("scope")).toBe("profile_nickname account_email");
    expect(kakao.searchParams.get("code_challenge")).toBe("kakao-pkce-challenge");
    expect(kakao.searchParams.get("code_challenge_method")).toBe("S256");

    const google = client.createAuthorizationUrl("google", {
      state: "state-value",
      nonce: "nonce-value",
      codeChallenge: "pkce-challenge",
    });
    expect(google.origin + google.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(google.searchParams.get("response_type")).toBe("code");
    expect(google.searchParams.get("client_id")).toBe("client-id");
    expect(google.searchParams.get("redirect_uri")).toBe("https://app.example.test/oauth/callback");
    expect(google.searchParams.get("state")).toBe("state-value");
    expect(google.searchParams.get("scope")).toBe("openid email profile");
    expect(google.searchParams.get("nonce")).toBe("nonce-value");
    expect(google.searchParams.get("code_challenge")).toBe("pkce-challenge");
    expect(google.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("exchanges a Naver code with state and PKCE, then reads the profile with a bearer token", async () => {
    const requestFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      if (value === "https://nid.naver.com/oauth2.0/token") {
        const body = new URLSearchParams(String(init?.body));
        expect(init?.method).toBe("POST");
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("client_id")).toBe("client-id");
        expect(body.get("client_secret")).toBe("client-secret");
        expect(body.get("redirect_uri")).toBe("https://app.example.test/oauth/callback");
        expect(body.get("code")).toBe("naver-code");
        expect(body.get("state")).toBe("naver-state");
        expect(body.get("code_verifier")).toBe("naver-verifier");
        return new Response(JSON.stringify({ access_token: "naver-access-token", token_type: "bearer" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      expect(value).toBe("https://openapi.naver.com/v1/nid/me");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer naver-access-token");
      return new Response(JSON.stringify({
        resultcode: "00",
        response: { id: "naver-login-user", email: "NAVER.LOGIN@EXAMPLE.COM", nickname: "네이버 로그인" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = new OAuthClient({ providers: { naver: baseConfig }, fetch: requestFetch as typeof fetch });

    await expect(client.exchangeCode("naver", {
      code: "naver-code",
      state: "naver-state",
      codeVerifier: "naver-verifier",
    })).resolves.toEqual({
      provider: "naver",
      subject: "naver-login-user",
      email: "naver.login@example.com",
      emailVerified: false,
      displayName: "네이버 로그인",
    });
    expect(requestFetch).toHaveBeenCalledTimes(2);
  });

  it("exchanges a Kakao code with PKCE, then maps its verified profile", async () => {
    const requestFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      if (value === "https://kauth.kakao.com/oauth/token") {
        const body = new URLSearchParams(String(init?.body));
        expect(init?.method).toBe("POST");
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("client_id")).toBe("client-id");
        expect(body.get("client_secret")).toBe("client-secret");
        expect(body.get("redirect_uri")).toBe("https://app.example.test/oauth/callback");
        expect(body.get("code")).toBe("kakao-code");
        expect(body.get("code_verifier")).toBe("kakao-verifier");
        return new Response(JSON.stringify({ access_token: "kakao-access-token", token_type: "bearer" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      expect(value).toBe("https://kapi.kakao.com/v2/user/me");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer kakao-access-token");
      return new Response(JSON.stringify({
        id: 987654321,
        kakao_account: {
          email: "KAKAO.LOGIN@EXAMPLE.COM",
          is_email_verified: true,
          profile: { nickname: "카카오 로그인" },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = new OAuthClient({ providers: { kakao: baseConfig }, fetch: requestFetch as typeof fetch });

    await expect(client.exchangeCode("kakao", {
      code: "kakao-code",
      state: "kakao-state",
      codeVerifier: "kakao-verifier",
    })).resolves.toEqual({
      provider: "kakao",
      subject: "987654321",
      email: "kakao.login@example.com",
      emailVerified: true,
      displayName: "카카오 로그인",
    });
    expect(requestFetch).toHaveBeenCalledTimes(2);
  });

  it("normalizes Naver and Kakao profiles without exposing access tokens", async () => {
    const requestFetch = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes("oauth2.0/token") || value.includes("oauth/token")) {
        return new Response(JSON.stringify({ access_token: "secret-provider-token" }), { status: 200 });
      }
      if (value.includes("naver")) {
        return new Response(JSON.stringify({
          resultcode: "00",
          response: { id: "naver-user", email: "USER@EXAMPLE.COM", name: "네이버 회원" },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: 12345,
        kakao_account: {
          email: "KAKAO@EXAMPLE.COM",
          is_email_verified: true,
          profile: { nickname: "카카오 회원" },
        },
      }), { status: 200 });
    });
    const client = new OAuthClient({
      providers: { naver: baseConfig, kakao: baseConfig },
      fetch: requestFetch as typeof fetch,
    });

    await expect(client.exchangeCode("naver", {
      code: "naver-code", state: "state", codeVerifier: "verifier",
    })).resolves.toEqual({
      provider: "naver", subject: "naver-user", email: "user@example.com",
      emailVerified: false, displayName: "네이버 회원",
    });
    await expect(client.exchangeCode("kakao", {
      code: "kakao-code", state: "state", codeVerifier: "verifier",
    })).resolves.toEqual({
      provider: "kakao", subject: "12345", email: "kakao@example.com",
      emailVerified: true, displayName: "카카오 회원",
    });
  });

  it("rejects missing providers and a Google flow without nonce", () => {
    const client = new OAuthClient({ providers: { google: baseConfig } });
    expect(() => client.createAuthorizationUrl("naver", { state: "state" })).toThrowError(OAuthComponentError);
    expect(() => client.createAuthorizationUrl("google", { state: "state" })).toThrow(/nonce/);
  });

  it("verifies Google ID token signature, issuer, audience and nonce", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    const idToken = await new SignJWT({
      email: "GOOGLE@EXAMPLE.COM",
      email_verified: true,
      name: "Google 회원",
      nonce: "expected-nonce",
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("google-subject")
      .setIssuer("https://accounts.google.com")
      .setAudience("google-client")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const requestFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      if (value === "https://oauth.example.test/certs") {
        return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: "test-key", alg: "RS256", use: "sig" }] }));
      }
      expect(value).toBe("https://oauth.example.test/token");
      const body = new URLSearchParams(String(init?.body));
      expect(init?.method).toBe("POST");
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("client_id")).toBe("google-client");
      expect(body.get("client_secret")).toBe("google-secret");
      expect(body.get("redirect_uri")).toBe("https://app.example.test/oauth/google/callback");
      expect(body.get("code")).toBe("google-code");
      expect(body.get("code_verifier")).toBe("verifier");
      return new Response(JSON.stringify({ access_token: "access-token", id_token: idToken }));
    });
    const client = new OAuthClient({
      providers: {
        google: {
          clientId: "google-client",
          clientSecret: "google-secret",
          redirectUri: "https://app.example.test/oauth/google/callback",
          tokenEndpoint: "https://oauth.example.test/token",
          jwksUri: "https://oauth.example.test/certs",
        },
      },
      fetch: requestFetch as typeof fetch,
    });

    await expect(client.exchangeCode("google", {
      code: "google-code", state: "state", nonce: "expected-nonce", codeVerifier: "verifier",
    })).resolves.toEqual({
      provider: "google",
      subject: "google-subject",
      email: "google@example.com",
      emailVerified: true,
      displayName: "Google 회원",
    });
    const callsBeforeMissingNonce = requestFetch.mock.calls.length;
    await expect(client.exchangeCode("google", {
      code: "google-code", state: "state", codeVerifier: "verifier",
    })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(requestFetch).toHaveBeenCalledTimes(callsBeforeMissingNonce);
    await expect(client.exchangeCode("google", {
      code: "google-code", state: "state", nonce: "wrong-nonce", codeVerifier: "verifier",
    })).rejects.toMatchObject({ code: "INVALID_IDENTITY" });
  });
});
