import { Controller, Get, Header, Param } from "@nestjs/common";
import { QrService } from "./qr.service.js";

@Controller("qr")
export class QrController {
  constructor(private readonly qrService: QrService) {}

  @Get(":code")
  @Header("Cache-Control", "private, no-store")
  resolve(@Param("code") code: string) {
    return this.qrService.resolve(code);
  }
}
