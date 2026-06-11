import { Module } from "@nestjs/common";
import { PatientController } from "./patient.controller";
import { PatientService } from "./patient.service";
import { PatientScopeService } from "./patient-scope.service";
import { RbacModule } from "../rbac/rbac.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [RbacModule, AuthModule, AuthModule],
  controllers: [PatientController],
  providers: [PatientService, PatientScopeService],
  exports: [PatientScopeService],
})
export class PatientModule {}
