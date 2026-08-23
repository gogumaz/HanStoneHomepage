import { loadOAuthComponentOptions } from "../auth/oauth-options.js";
import { ApiError } from "../common/api-error.js";
import { PaymentComponentError } from "../components/payments/payment-provider.js";
import { PortOneV1PaymentProvider } from "../components/payments/portone-v1.provider.js";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { AccountMailService } from "../mail/account-mail.service.js";
import { MalwareScannerService } from "../storage/malware-scanner.service.js";
import { MediaDeliveryService } from "../storage/media-delivery.service.js";
import { HlsTranscoderService } from "../content/hls-transcoder.service.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";

export type PreflightCheckName =
  | "configuration"
  | "database"
  | "objectStorage"
  | "cdn"
  | "hlsTranscoder"
  | "malwareScanner"
  | "smtp"
  | "portone";

export type PreflightCheck = {
  name: PreflightCheckName;
  status: "pass" | "fail";
  durationMs: number;
  detail: string;
};

export type ProductionPreflightReport = {
  ok: boolean;
  checkedAt: string;
  checks: PreflightCheck[];
};

class ConfigurationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ConfigurationError";
  }
}

function errorCode(error: unknown): string {
  if (error instanceof ConfigurationError) return error.code;
  if (error instanceof ApiError || error instanceof PaymentComponentError) return error.code;
  if (error instanceof Error && error.name) return error.name.slice(0, 100);
  return "PREFLIGHT_CHECK_FAILED";
}

function requiredOAuthProviders(env: NodeJS.ProcessEnv): Array<"naver" | "kakao" | "google"> {
  const raw = env.PREFLIGHT_REQUIRED_OAUTH_PROVIDERS
    ?? (env.NODE_ENV === "production" ? "naver,kakao,google" : "");
  const providers = raw.split(",").map((value) => value.trim()).filter(Boolean);
  const allowed = new Set(["naver", "kakao", "google"]);
  if (providers.some((provider) => !allowed.has(provider))) {
    throw new ConfigurationError("PREFLIGHT_OAUTH_PROVIDER_INVALID");
  }
  return [...new Set(providers)] as Array<"naver" | "kakao" | "google">;
}

export class ProductionPreflightService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly delivery: MediaDeliveryService,
    private readonly transcoder: HlsTranscoderService,
    private readonly scanner: MalwareScannerService,
    private readonly mail: AccountMailService,
  ) {}

  async run(env: NodeJS.ProcessEnv = process.env): Promise<ProductionPreflightReport> {
    const config = loadAppConfig(env);
    const checks = await Promise.all([
      this.check("configuration", async () => {
        const oauth = loadOAuthComponentOptions(env);
        const configuredProviders = Object.keys(oauth.providers);
        const missingProviders = requiredOAuthProviders(env)
          .filter((provider) => !(provider in oauth.providers));
        if (missingProviders.length > 0) throw new ConfigurationError("OAUTH_PROVIDERS_MISSING");
        if (!config.portoneV1ApiKey || !config.portoneV1ApiSecret) {
          throw new ConfigurationError("PORTONE_NOT_CONFIGURED");
        }
        if (config.nodeEnv === "production" && new URL(config.publicAppUrl).protocol !== "https:") {
          throw new ConfigurationError("PUBLIC_APP_URL_HTTPS_REQUIRED");
        }
        if (config.nodeEnv === "production" && Object.values(oauth.providers).some(
          (provider) => new URL(provider.redirectUri).protocol !== "https:",
        )) {
          throw new ConfigurationError("OAUTH_REDIRECT_HTTPS_REQUIRED");
        }
        if (!config.corsOrigins.includes(new URL(config.publicAppUrl).origin)) {
          throw new ConfigurationError("PUBLIC_APP_ORIGIN_NOT_ALLOWED_BY_CORS");
        }
        return `oauth=${configuredProviders.sort().join(",") || "none"}; portone=configured`;
      }),
      this.check("database", async () => {
        await this.prisma.$queryRawUnsafe("SELECT 1");
        await this.prisma.objectDeletionJob.count();
        return "connection=ok; latestSchema=ok";
      }),
      this.check("objectStorage", async () => {
        await this.storage.verifyVideoStorageAccess();
        return "put=get=delete=ok";
      }),
      this.check("cdn", async () => {
        const provider = await this.delivery.verifyCdnConnection();
        if (config.preflightRequireCdn && provider === "disabled") {
          throw new ConfigurationError("CDN_NOT_CONFIGURED");
        }
        return provider === "disabled"
          ? "disabled"
          : `provider=${provider}; signedFetch=ok; probeDeleted=true`;
      }),
      this.check("hlsTranscoder", async () => {
        await this.transcoder.verifyBinaries();
        return "ffmpeg=ok; ffprobe=ok; mutation=false";
      }),
      this.check("malwareScanner", async () => {
        const result = await this.scanner.scan(new TextEncoder().encode("baduk-history-preflight"));
        if (!result.clean) throw new ConfigurationError("MALWARE_SCANNER_UNEXPECTED_DETECTION");
        return `provider=${result.provider}; result=${result.result}`;
      }),
      this.check("smtp", async () => {
        await this.mail.verifyConnection();
        return "dns=tcp=tls=auth=ok; messageSent=false";
      }),
      this.check("portone", async () => {
        const provider = new PortOneV1PaymentProvider({
          apiKey: config.portoneV1ApiKey,
          apiSecret: config.portoneV1ApiSecret,
        });
        await provider.verifyConnection(AbortSignal.timeout(10_000));
        return "credentials=ok; paymentMutation=false";
      }),
    ]);
    return {
      ok: checks.every((check) => check.status === "pass"),
      checkedAt: new Date().toISOString(),
      checks,
    };
  }

  private async check(
    name: PreflightCheckName,
    operation: () => Promise<string>,
  ): Promise<PreflightCheck> {
    const startedAt = Date.now();
    try {
      const detail = await operation();
      return {
        name,
        status: "pass",
        durationMs: Date.now() - startedAt,
        detail,
      };
    } catch (error) {
      return {
        name,
        status: "fail",
        durationMs: Date.now() - startedAt,
        detail: errorCode(error),
      };
    }
  }
}
