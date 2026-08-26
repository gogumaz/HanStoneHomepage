import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import { ApiResponseInterceptor } from "./common/api-response.interceptor.js";
import { RequestIdMiddleware } from "./common/request-id.middleware.js";
import { configureRequestBodyParsers } from "./common/request-body-limit.js";
import { apiSecurityHeaders } from "./common/security-headers.js";
import { loadAppConfig } from "./config/app-config.js";

async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  if (config.trustProxyHops > 0) {
    const express = app.getHttpAdapter().getInstance() as {
      set(name: string, value: number): void;
    };
    express.set("trust proxy", config.trustProxyHops);
  }

  app.setGlobalPrefix("api/v1");
  app.use(helmet(apiSecurityHeaders(config.nodeEnv)));
  const requestIdMiddleware = new RequestIdMiddleware();
  app.use(requestIdMiddleware.use.bind(requestIdMiddleware));
  configureRequestBodyParsers(app, config.requestBodyMaxBytes);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    exposedHeaders: [
      "x-request-id",
      "RateLimit-Limit",
      "RateLimit-Remaining",
      "RateLimit-Reset",
      "Retry-After",
    ],
  });
  app.enableShutdownHooks();

  await app.listen(config.port, "0.0.0.0");
}

void bootstrap();
