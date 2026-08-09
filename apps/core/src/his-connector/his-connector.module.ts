import { Module } from "@nestjs/common";
import { HospitalSysConnectorController } from "./hospital-sys-connector.controller";
import { HospitalSysConnectorService } from "./hospital-sys-connector.service";
import { PatientModule } from "../patient/patient.module";
import { RbacModule } from "../rbac/rbac.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [PatientModule, RbacModule, AuthModule],
  controllers: [HospitalSysConnectorController],
  providers: [HospitalSysConnectorService],
})
export class HisConnectorModule {}
