import { Module } from "@nestjs/common";
import { PatientModule } from "../patient/patient.module";
// RbacModule and AuthModule are not optional company for a module that guards its routes: the RBAC
// guard resolves SessionService at runtime, so omitting them fails at BOOT, not at build. This module
// shipped without them and the API refused to start while every service test stayed green.
import { RbacModule } from "../rbac/rbac.module";
import { AuthModule } from "../auth/auth.module";
import { DocumentationController } from "./documentation.controller";
import { DocumentationService } from "./documentation.service";

@Module({
  imports: [PatientModule, RbacModule, AuthModule],
  controllers: [DocumentationController],
  providers: [DocumentationService],
})
export class DocumentationModule {}
