import { Module } from "@nestjs/common";
import { AmbientService } from "./ambient.service";
import { AmbientController } from "./ambient.controller";
import { PatientModule } from "../patient/patient.module";
import { AuditModule } from "../audit/audit.module";
import { RbacModule } from "../rbac/rbac.module";

@Module({
  imports: [PatientModule, AuditModule, RbacModule],
  controllers: [AmbientController],
  providers: [AmbientService],
})
export class AmbientModule {}
