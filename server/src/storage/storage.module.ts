import { Module } from "@nestjs/common";
import { ObjectStorageService } from "./object-storage.service.js";
import { MalwareScannerService } from "./malware-scanner.service.js";
import { CloudFrontPlaybackProvider } from "./cloudfront-playback.provider.js";
import { MediaDeliveryService } from "./media-delivery.service.js";

@Module({
  providers: [ObjectStorageService, MalwareScannerService, CloudFrontPlaybackProvider, MediaDeliveryService],
  exports: [ObjectStorageService, MalwareScannerService, MediaDeliveryService],
})
export class StorageModule {}
