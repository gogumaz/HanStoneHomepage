import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OperationsController } from "./operations.controller.js";
import { WorkerHealthService } from "./worker-health.service.js";
import { InternalMetricsController } from "./internal-metrics.controller.js";
import { MetricsTokenGuard } from "./metrics-token.guard.js";

@Module({
  imports: [AuthModule],
  controllers: [OperationsController, InternalMetricsController],
  providers: [WorkerHealthService, MetricsTokenGuard],
})
export class OperationsModule {}
