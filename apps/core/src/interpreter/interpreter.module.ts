import { Module } from "@nestjs/common";
import { InterpreterService } from "./interpreter.service";
import { InterpreterController } from "./interpreter.controller";
import { PatientModule } from "../patient/patient.module";
import { AuditModule } from "../audit/audit.module";
import { RbacModule } from "../rbac/rbac.module";

@Module({
  imports: [PatientModule, AuditModule, RbacModule],
  controllers: [InterpreterController],
  providers: [InterpreterService],
})
export class InterpreterModule {}
