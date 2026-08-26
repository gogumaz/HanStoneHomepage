import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { ClassHelperAssetService } from "./class-helper-asset.service.js";
import { ClassHelperController } from "./class-helper.controller.js";
import { ClassHelperService } from "./class-helper.service.js";

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [ClassHelperController],
  providers: [ClassHelperService, ClassHelperAssetService],
})
export class ClassHelperModule {}
