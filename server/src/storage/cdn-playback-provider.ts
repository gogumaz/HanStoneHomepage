export type SignedPlaybackUrl = {
  url: string;
  expiresAt: Date;
  provider: "object-storage" | "cloudfront";
};

export interface CdnPlaybackProvider {
  readonly name: "cloudfront";
  isConfigured(): boolean;
  sign(objectKey: string): SignedPlaybackUrl;
  verifyLocalSigning(): void;
}
