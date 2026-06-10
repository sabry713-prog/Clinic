import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AuthModule } from "../auth/auth.module";
import { AuditVerifyService } from "../audit/audit-verify.service";
import { WormExportService } from "../audit/worm-export.service";
import { DatabaseModule } from "../database/database.module";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [AdminController],
  providers: [AuditVerifyService, WormExportService],
  exports: [AuditVerifyService, WormExportService],
})
export class AdminModule {}
