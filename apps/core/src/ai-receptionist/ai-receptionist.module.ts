import { Module } from "@nestjs/common";
import { PatientIdentityController } from "./patient-identity.controller";
import { PatientBookingController } from "./patient-booking.controller";
import { ProviderAvailabilityController } from "./provider-availability.controller";
import { PatientOtpService } from "./patient-otp.service";
import { PatientBookingSessionService } from "./patient-booking-session.service";
import { PatientBookingSessionGuard } from "./patient-booking-session.guard";
import { AvailabilityService } from "./availability.service";
import { ReceptionistNluService } from "./receptionist-nlu.service";
import { ProviderAvailabilityService } from "./provider-availability.service";
import { PatientEngagementModule } from "../patient-engagement/patient-engagement.module";
import { RbacModule } from "../rbac/rbac.module";

@Module({
  imports: [PatientEngagementModule, RbacModule],
  controllers: [PatientIdentityController, PatientBookingController, ProviderAvailabilityController],
  providers: [
    PatientOtpService,
    PatientBookingSessionService,
    PatientBookingSessionGuard,
    AvailabilityService,
    ReceptionistNluService,
    ProviderAvailabilityService,
  ],
})
export class AiReceptionistModule {}
