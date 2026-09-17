import { Module } from "@nestjs/common";
import { DsrController } from "./dsr.controller";
import { DsrService } from "./dsr.service";
import { RbacModule } from "../rbac/rbac.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  // RbacModule provides the guard the controller applies: @UseGuards(RbacGuard)
  // makes Nest instantiate it in this module's injector, so it has to be
  // resolvable here (it was not, which stopped the application booting).
  //
  // AuditModule provides AuditOutboxService for the same reason: the erasure
  // hands its audit entry to the outbox inside its own transaction.
  imports: [RbacModule, AuditModule],
  controllers: [DsrController],
  providers: [DsrService],
  exports: [DsrService],
})
export class DsrModule {}
