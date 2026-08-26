import { Controller, Get, Header, UseGuards } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { WorkerHealthService } from "./worker-health.service.js";

@Controller("admin/operations")
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles("operator", "admin")
export class OperationsController {
  constructor(private readonly workerHealth: WorkerHealthService) {}

  @Get("worker-health")
  @Header("Cache-Control", "private, no-store")
  workerHealthReport() {
    return this.workerHealth.inspect();
  }
}
