import { createPrivateKey } from "node:crypto";
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
import { Injectable } from "@nestjs/common";
import { loadAppConfig } from "../config/app-config.js";
import type { CdnPlaybackProvider, SignedPlaybackUrl } from "./cdn-playback-provider.js";

const SAFE_OBJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/;

function assertSafeObjectKey(objectKey: string): void {
  const segments = objectKey.split("/");
  if (
    !SAFE_OBJECT_KEY.test(objectKey)
    || objectKey.startsWith("/")
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) throw new Error("CDN_OBJECT_KEY_INVALID");
}

@Injectable()
export class CloudFrontPlaybackProvider implements CdnPlaybackProvider {
  readonly name = "cloudfront" as const;
  private readonly baseUrl: string | null;
  private readonly keyPairId: string | null;
  private readonly privateKey: string | null;
  private readonly ttlSeconds: number;

  constructor() {
    const config = loadAppConfig();
    this.baseUrl = config.playbackCdnProvider === "cloudfront" ? config.playbackCdnBaseUrl : null;
    this.keyPairId = config.playbackCdnProvider === "cloudfront" ? config.playbackCdnKeyPairId : null;
    this.privateKey = config.playbackCdnProvider === "cloudfront" && config.playbackCdnPrivateKeyBase64
      ? Buffer.from(config.playbackCdnPrivateKeyBase64, "base64").toString("utf8")
      : null;
    this.ttlSeconds = config.playbackUrlTtlSeconds;
    if (this.isConfigured()) this.assertPrivateKey();
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.keyPairId && this.privateKey);
  }

  sign(objectKey: string): SignedPlaybackUrl {
    if (!this.baseUrl || !this.keyPairId || !this.privateKey) throw new Error("CDN_NOT_CONFIGURED");
    assertSafeObjectKey(objectKey);
    const encodedPath = objectKey.split("/").map(encodeURIComponent).join("/");
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    const url = getSignedUrl({
      url: `${this.baseUrl}/${encodedPath}`,
      keyPairId: this.keyPairId,
      privateKey: this.privateKey,
      dateLessThan: expiresAt,
      algorithm: "SHA256",
    });
    return { url, expiresAt, provider: "cloudfront" };
  }

  verifyLocalSigning(): void {
    const signed = this.sign("lesson-hls/preflight/signer-check.m4s");
    const url = new URL(signed.url);
    if (
      !url.searchParams.get("Expires")
      || !url.searchParams.get("Signature")
      || url.searchParams.get("Key-Pair-Id") !== this.keyPairId
      || url.searchParams.get("Hash-Algorithm") !== "SHA256"
    ) throw new Error("CDN_SIGNING_INVALID");
  }

  private assertPrivateKey(): void {
    try {
      const key = createPrivateKey(this.privateKey as string);
      if (key.asymmetricKeyType !== "rsa") throw new Error("not RSA");
    } catch {
      throw new Error("PLAYBACK_CDN_PRIVATE_KEY_INVALID");
    }
  }
}
