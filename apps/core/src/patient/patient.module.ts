import { Module } from "@nestjs/common";
import { PatientController } from "./patient.controller";
import { PatientService } from "./patient.service";
import { PatientScopeService } from "./patient-scope.service";
import { RbacModule } from "../rbac/rbac.module";

@Module({
  imports: [RbacModule],
  controllers: [PatientController],
  providers: [PatientService, PatientScopeService],
  exports: [PatientScopeService],
})
export class PatientModule {}
