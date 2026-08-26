import type { NestExpressApplication } from "@nestjs/platform-express";

export function configureRequestBodyParsers(
  app: NestExpressApplication,
  maxBytes: number,
): void {
  app.useBodyParser("json", { limit: maxBytes });
  app.useBodyParser("urlencoded", { limit: maxBytes, extended: false });
}
