import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";

export type HealthResponse = {
  service: string;
  status: "ok";
  database?: "ok";
  timestamp: string;
};

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  liveness(): HealthResponse {
    return {
      service: "baduk-history-api",
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<HealthResponse> {
    if (!(await this.prisma.isReady())) {
      throw new ServiceUnavailableException({
        service: "baduk-history-api",
        status: "unavailable",
        database: "unavailable",
        timestamp: new Date().toISOString(),
      });
    }

    return {
      service: "baduk-history-api",
      status: "ok",
      database: "ok",
      timestamp: new Date().toISOString(),
    };
  }
}
