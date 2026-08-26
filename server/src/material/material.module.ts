import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { MaterialAssetService } from "./material-asset.service.js";
import { MaterialController } from "./material.controller.js";
import { MaterialService } from "./material.service.js";

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [MaterialController],
  providers: [MaterialService, MaterialAssetService],
})
export class MaterialModule {}
