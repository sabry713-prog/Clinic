import { Module } from "@nestjs/common";
import { ServiceRequestController } from "./service-request.controller";
import { ServiceRequestService } from "./service-request.service";
import { PatientModule } from "../patient/patient.module";
import { RbacModule } from "../rbac/rbac.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [PatientModule, RbacModule, AuthModule],
  controllers: [ServiceRequestController],
  providers: [ServiceRequestService],
})
export class ServiceRequestModule {}
