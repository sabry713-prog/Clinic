import { Module } from "@nestjs/common";
import { NphiesController } from "./nphies.controller";
import { ClaimReadinessService } from "./claim-readiness.service";
import { PatientModule } from "../patient/patient.module";
import { RbacModule } from "../rbac/rbac.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [PatientModule, RbacModule, AuthModule],
  controllers: [NphiesController],
  providers: [ClaimReadinessService],
})
export class NphiesModule {}
