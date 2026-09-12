import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { EditorialController } from "./editorial.controller.js";
import { EditorialService } from "./editorial.service.js";

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [EditorialController],
  providers: [EditorialService],
})
export class EditorialModule {}
