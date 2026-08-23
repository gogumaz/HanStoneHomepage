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
    expect(naver.searchParams.get("state")).toBe("state-value");
    expect(naver.searchParams.get("code_challenge_method")).toBe("S256");

    const google = client.createAuthorizationUrl("google", {
      state: "state-value",
      nonce: "nonce-value",
      codeChallenge: "pkce-challenge",
    });
    expect(google.searchParams.get("scope")).toBe("openid email profile");
    expect(google.searchParams.get("nonce")).toBe("nonce-value");
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
    const requestFetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("certs")) {
        return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: "test-key", alg: "RS256", use: "sig" }] }));
      }
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
    await expect(client.exchangeCode("google", {
      code: "google-code", state: "state", nonce: "wrong-nonce", codeVerifier: "verifier",
    })).rejects.toMatchObject({ code: "INVALID_IDENTITY" });
  });
});
