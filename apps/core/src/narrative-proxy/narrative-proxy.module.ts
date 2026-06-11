import { Module } from "@nestjs/common";
import { NarrativeProxyService } from "./narrative-proxy.service";
import { NarrativeProxyController } from "./narrative-proxy.controller";
import { PatientModule } from "../patient/patient.module";
import { AuditModule } from "../audit/audit.module";
import { RbacModule } from "../rbac/rbac.module";

@Module({
  imports: [PatientModule, AuditModule, RbacModule],
  controllers: [NarrativeProxyController],
  providers: [NarrativeProxyService],
})
export class NarrativeProxyModule {}
