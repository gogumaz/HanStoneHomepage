import type { IncomingMessage, ServerResponse } from "node:http";
import type { NestExpressApplication } from "@nestjs/platform-express";

export function configureRequestBodyParsers(
  app: NestExpressApplication,
  maxBytes: number,
): void {
  app.useBodyParser("json", {
    limit: maxBytes,
    verify: (request: IncomingMessage, _response: ServerResponse, buffer: Buffer) => {
      const candidate = request as typeof request & { originalUrl?: string; rawBody?: Buffer };
      if (candidate.originalUrl?.split("?", 1)[0]?.endsWith("/mail/webhooks/resend")) {
        candidate.rawBody = Buffer.from(buffer);
      }
    },
  });
  app.useBodyParser("urlencoded", { limit: maxBytes, extended: false });
}
