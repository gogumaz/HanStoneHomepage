import { Injectable } from "@nestjs/common";
import type { SignedPlaybackUrl } from "./cdn-playback-provider.js";
import { CloudFrontPlaybackProvider } from "./cloudfront-playback.provider.js";
import { ObjectStorageService } from "./object-storage.service.js";

@Injectable()
export class MediaDeliveryService {
  constructor(
    private readonly storage: ObjectStorageService,
    private readonly cloudFront: CloudFrontPlaybackProvider,
  ) {}

  isConfigured(): boolean {
    return this.storage.isConfigured();
  }

  isCdnEnabled(): boolean {
    return this.cloudFront.isConfigured();
  }

  getPlaybackExpiresAt(): Date {
    return this.storage.getPlaybackExpiresAt();
  }

  async signPlaybackUrl(objectKey: string): Promise<SignedPlaybackUrl> {
    if (this.cloudFront.isConfigured()) return this.cloudFront.sign(objectKey);
    const signed = await this.storage.signPlaybackUrl(objectKey);
    return { ...signed, provider: "object-storage" };
  }

  async signHlsAssetUrl(objectKey: string): Promise<SignedPlaybackUrl> {
    if (this.cloudFront.isConfigured()) return this.cloudFront.sign(objectKey);
    const signed = await this.storage.signHlsAssetUrl(objectKey);
    return { ...signed, provider: "object-storage" };
  }

  async verifyCdnConnection(): Promise<"disabled" | "cloudfront"> {
    if (!this.cloudFront.isConfigured()) return "disabled";
    this.cloudFront.verifyLocalSigning();
    await this.storage.verifyCdnDelivery((objectKey) => Promise.resolve(this.cloudFront.sign(objectKey)));
    return "cloudfront";
  }
}
