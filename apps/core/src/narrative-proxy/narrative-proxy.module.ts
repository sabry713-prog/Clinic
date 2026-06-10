import { Module } from "@nestjs/common";
import { NarrativeProxyService } from "./narrative-proxy.service";
import { NarrativeProxyController } from "./narrative-proxy.controller";
import { PatientModule } from "../patient/patient.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [PatientModule, AuditModule],
  controllers: [NarrativeProxyController],
  providers: [NarrativeProxyService],
})
export class NarrativeProxyModule {}
