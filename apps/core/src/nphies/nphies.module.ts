import { Module } from "@nestjs/common";
import { NphiesController } from "./nphies.controller";
import { ClaimReadinessService } from "./claim-readiness.service";
import { IcdCodingService } from "./icd-coding.service";
import { SbsCodingService } from "./sbs-coding.service";
import { LinkageService } from "./linkage.service";
import { NphiesConnectorService } from "./connector.service";
import { RejectionRiskService } from "./rejection-risk.service";
import { PreAuthService } from "./preauth.service";
import { PatientModule } from "../patient/patient.module";
import { RbacModule } from "../rbac/rbac.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [PatientModule, RbacModule, AuthModule],
  controllers: [NphiesController],
  providers: [ClaimReadinessService, IcdCodingService, SbsCodingService, LinkageService, NphiesConnectorService, RejectionRiskService, PreAuthService],
  // ClaimReadinessService is re-exported for the claim-integrity module's
  // batch simulator, which reuses the exact same deterministic checks.
  exports: [ClaimReadinessService],
})
export class NphiesModule {}
