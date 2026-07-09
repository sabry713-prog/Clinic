import { Module } from "@nestjs/common";
import { NphiesController } from "./nphies.controller";
import { ClaimReadinessService } from "./claim-readiness.service";
import { IcdCodingService } from "./icd-coding.service";
import { SbsCodingService } from "./sbs-coding.service";
import { LinkageService } from "./linkage.service";
import { NphiesConnectorService } from "./connector.service";
import { RejectionRiskService } from "./rejection-risk.service";
import { PatientModule } from "../patient/patient.module";
import { RbacModule } from "../rbac/rbac.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [PatientModule, RbacModule, AuthModule],
  controllers: [NphiesController],
  providers: [ClaimReadinessService, IcdCodingService, SbsCodingService, LinkageService, NphiesConnectorService, RejectionRiskService],
})
export class NphiesModule {}
