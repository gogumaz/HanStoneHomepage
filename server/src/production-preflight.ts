import "dotenv/config";
import { PrismaService } from "./database/prisma.service.js";
import { AccountMailService } from "./mail/account-mail.service.js";
import { ProductionPreflightService } from "./operations/production-preflight.service.js";
import { MalwareScannerService } from "./storage/malware-scanner.service.js";
import { CloudFrontPlaybackProvider } from "./storage/cloudfront-playback.provider.js";
import { MediaDeliveryService } from "./storage/media-delivery.service.js";
import { HlsTranscoderService } from "./content/hls-transcoder.service.js";
import { ObjectStorageService } from "./storage/object-storage.service.js";
import { createRateLimitStore } from "./common/rate-limit.store.js";
import { withEvidenceCommitSha } from "./operations/evidence-metadata.js";

async function bootstrap(): Promise<void> {
  const prisma = new PrismaService();
  const rateLimitStore = createRateLimitStore();
  try {
    const storage = new ObjectStorageService();
    const delivery = new MediaDeliveryService(storage, new CloudFrontPlaybackProvider());
    const report = await new ProductionPreflightService(
      prisma,
      storage,
      delivery,
      new HlsTranscoderService(),
      new MalwareScannerService(),
      new AccountMailService(),
      rateLimitStore,
    ).run();
    process.stdout.write(`${JSON.stringify(withEvidenceCommitSha(report), null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await rateLimitStore.close();
  }
}

void bootstrap().catch((error: unknown) => {
  const detail = error instanceof Error ? error.name : "PREFLIGHT_BOOTSTRAP_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, detail })}\n`);
  process.exitCode = 1;
});
