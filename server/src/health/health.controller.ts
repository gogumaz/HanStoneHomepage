import { Controller, Get } from "@nestjs/common";
import { HealthResponse, HealthService } from "./health.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get("live")
  live(): HealthResponse {
    return this.healthService.liveness();
  }

  @Get("ready")
  ready(): Promise<HealthResponse> {
    return this.healthService.readiness();
  }
}
