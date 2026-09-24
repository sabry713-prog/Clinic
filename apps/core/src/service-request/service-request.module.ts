import { Module } from "@nestjs/common";
import { ServiceRequestController } from "./service-request.controller";
import { NecessityLookupService } from "../nphies/necessity-lookup.service";
import { ServiceRequestService } from "./service-request.service";
import { PatientModule } from "../patient/patient.module";
import { RbacModule } from "../rbac/rbac.module";
import { AuthModule } from "../auth/auth.module";
import { SecurityModule } from "../security/security.module";

@Module({
  imports: [PatientModule, RbacModule, AuthModule, SecurityModule],
  controllers: [ServiceRequestController],
  providers: [ServiceRequestService, NecessityLookupService],
})
export class ServiceRequestModule {}
