import { Module } from "@nestjs/common";
import { PatientModule } from "../patient/patient.module";
import { RbacModule } from "../rbac/rbac.module";
import { AuthModule } from "../auth/auth.module";
import { ConditionController } from "./condition.controller";
import { ConditionService } from "./condition.service";

@Module({
  imports: [PatientModule, RbacModule, AuthModule],
  controllers: [ConditionController],
  providers: [ConditionService],
})
export class ConditionModule {}
