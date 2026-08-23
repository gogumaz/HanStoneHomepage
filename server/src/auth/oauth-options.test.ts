import { describe, expect, it } from "vitest";
import { loadOAuthComponentOptions } from "./oauth-options.js";

describe("loadOAuthComponentOptions", () => {
  it("keeps OAuth disabled when no provider is configured", () => {
    expect(loadOAuthComponentOptions({})).toEqual({ providers: {} });
  });

  it("loads complete provider credentials without exposing them to the browser", () => {
    expect(loadOAuthComponentOptions({
      GOOGLE_CLIENT_ID: "google-id",
      GOOGLE_CLIENT_SECRET: "google-secret",
      GOOGLE_REDIRECT_URI: "https://api.example.com/api/v1/auth/oauth/google/callback",
    })).toEqual({
      providers: {
        google: {
          clientId: "google-id",
          clientSecret: "google-secret",
          redirectUri: "https://api.example.com/api/v1/auth/oauth/google/callback",
        },
      },
    });
  });

  it("rejects partial credentials and insecure non-local redirects", () => {
    expect(() => loadOAuthComponentOptions({ GOOGLE_CLIENT_ID: "only-id" })).toThrow(/GOOGLE OAuth 설정/);
    expect(() => loadOAuthComponentOptions({
      KAKAO_REST_API_KEY: "key",
      KAKAO_CLIENT_SECRET: "secret",
      KAKAO_REDIRECT_URI: "http://api.example.com/oauth/callback",
    })).toThrow(/HTTPS/);
  });
});
