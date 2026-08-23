import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import { ApiResponseInterceptor } from "./common/api-response.interceptor.js";
import { RequestIdMiddleware } from "./common/request-id.middleware.js";
import { loadAppConfig } from "./config/app-config.js";

async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix("api/v1");
  app.use(helmet());
  const requestIdMiddleware = new RequestIdMiddleware();
  app.use(requestIdMiddleware.use.bind(requestIdMiddleware));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    exposedHeaders: ["x-request-id"],
  });
  app.enableShutdownHooks();

  await app.listen(config.port, "0.0.0.0");
}

void bootstrap();
