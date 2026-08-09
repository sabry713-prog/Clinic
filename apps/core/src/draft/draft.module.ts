import { Module } from "@nestjs/common";
import { DraftController } from "./draft.controller";
import { DraftService } from "./draft.service";
import { PatientModule } from "../patient/patient.module";
import { RbacModule } from "../rbac/rbac.module";
import { AuthModule } from "../auth/auth.module";
import { SecurityModule } from "../security/security.module";

@Module({
  imports: [PatientModule, RbacModule, AuthModule, SecurityModule],
  controllers: [DraftController],
  providers: [DraftService],
})
export class DraftModule {}
