import { Module } from "@nestjs/common";
import { PatientModule } from "../patient/patient.module";
// RbacModule and AuthModule are not optional company for a module that guards its routes: the RBAC
// guard resolves SessionService at runtime, so omitting them fails at BOOT, not at build. This module
// shipped without them and the API refused to start while every service test stayed green.
import { RbacModule } from "../rbac/rbac.module";
import { AuthModule } from "../auth/auth.module";
import { ChecklistController } from "./checklist.controller";
import { ChecklistService } from "./checklist.service";

@Module({
  imports: [PatientModule, RbacModule, AuthModule],
  controllers: [ChecklistController],
  providers: [ChecklistService],
})
export class ChecklistModule {}
