import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AuthModule } from "../auth/auth.module";
import { AuditVerifyService } from "../audit/audit-verify.service";

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AuditVerifyService],
  exports: [AuditVerifyService],
})
export class AdminModule {}
