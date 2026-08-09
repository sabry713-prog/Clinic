import { Module } from "@nestjs/common";
import { AppointmentController } from "./appointment.controller";
import { AppointmentService } from "./appointment.service";
import { IntakeController } from "./intake.controller";
import { IntakeService } from "./intake.service";
import { ReminderController } from "./reminder.controller";
import { PatientEngagementConnectorService } from "./reminder-connector.service";
import { PatientModule } from "../patient/patient.module";
import { RbacModule } from "../rbac/rbac.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [PatientModule, RbacModule, AuthModule],
  controllers: [AppointmentController, IntakeController, ReminderController],
  providers: [AppointmentService, IntakeService, PatientEngagementConnectorService],
  exports: [AppointmentService],
})
export class PatientEngagementModule {}
