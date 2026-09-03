import { Module } from "@nestjs/common";
import { QrController } from "./qr.controller.js";
import { QrService } from "./qr.service.js";

@Module({
  controllers: [QrController],
  providers: [QrService],
})
export class QrModule {}
