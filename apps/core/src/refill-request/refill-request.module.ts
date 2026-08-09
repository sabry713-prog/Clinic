import { Module } from "@nestjs/common";
import { RefillRequestController } from "./refill-request.controller";
import { RefillRequestService } from "./refill-request.service";
import { PatientModule } from "../patient/patient.module";
import { RbacModule } from "../rbac/rbac.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [PatientModule, RbacModule, AuthModule],
  controllers: [RefillRequestController],
  providers: [RefillRequestService],
})
export class RefillRequestModule {}
