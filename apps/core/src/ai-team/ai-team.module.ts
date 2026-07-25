import { Module } from "@nestjs/common";
import { AiTeamService } from "./ai-team.service";
import { AiTeamController } from "./ai-team.controller";
import { PatientModule } from "../patient/patient.module";
import { AuditModule } from "../audit/audit.module";
import { RbacModule } from "../rbac/rbac.module";

@Module({
  imports: [PatientModule, AuditModule, RbacModule],
  controllers: [AiTeamController],
  providers: [AiTeamService],
})
export class AiTeamModule {}
