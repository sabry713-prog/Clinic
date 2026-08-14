/**
 * PatientBookingController — session-scoped routes for the AI Receptionist
 * self-service booking flow (docs/architecture/ai-receptionist.md). Every
 * route is guarded by PatientBookingSessionGuard; patientId always comes
 * from the verified session (req.bookingSessionPatientId), never a
 * client-supplied body/path param.
 */
import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { v4 as uuidv4 } from "uuid";
import { IsIn, IsISO8601, IsOptional, IsString } from "class-validator";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { writeAuditEvent } from "@clinical-copilot/audit";
import type { RequestId } from "@clinical-copilot/shared-types";
import { PatientBookingSessionGuard } from "./patient-booking-session.guard";
import { AvailabilityService } from "./availability.service";
import { ReceptionistNluService } from "./receptionist-nlu.service";
import { AppointmentService } from "../patient-engagement/appointment.service";

const APPOINTMENT_TYPES = ["follow_up", "new_patient", "consultation", "procedure"] as const;

class BookAppointmentDto {
  @IsString()
  departmentDisplay!: string;

  @IsIn(APPOINTMENT_TYPES)
  appointmentType!: (typeof APPOINTMENT_TYPES)[number];

  @IsOptional()
  @IsString()
  clinicianDisplay?: string;

  @IsISO8601()
  slotStart!: string;
}

function patientId(req: Request): string {
  const id = req.bookingSessionPatientId;
  if (!id) throw new Error("No bookingSessionPatientId on request");
  return id;
}

@ApiTags("ai-receptionist")
@UseGuards(PatientBookingSessionGuard)
@Controller("booking")
export class PatientBookingController {
  constructor(
    private readonly availabilitySvc: AvailabilityService,
    private readonly nluSvc: ReceptionistNluService,
    private readonly appointmentSvc: AppointmentService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Get("nlu-match")
  @ApiOperation({ summary: "Match free text against known department/appointment-type names (catalog-only, never symptom inference)" })
  match(@Query("q") q: string) {
    return this.nluSvc.match(q ?? "");
  }

  @Get("availability")
  @ApiOperation({ summary: "List open slots for a department (and optional named clinician) within a date range" })
  async availability(
    @Query("departmentDisplay") departmentDisplay: string,
    @Query("clinicianDisplay") clinicianDisplay: string | undefined,
    @Query("dateFrom") dateFrom: string,
    @Query("dateTo") dateTo: string,
    @Query("clinicianGender") clinicianGender: string | undefined,
  ) {
    // S4.4 — optional patient preference for the serving clinician's gender.
    // An unrecognised value means "no preference" rather than a 400 on a
    // public form; filtering only happens on an exact declared match.
    const gender = clinicianGender === "male" || clinicianGender === "female" ? clinicianGender : null;
    const data = await this.availabilitySvc.getSlots(departmentDisplay, clinicianDisplay ?? null, dateFrom, dateTo, gender);
    return { data };
  }

  @Post("appointments")
  @ApiOperation({ summary: "Book an available slot (patient self-service)" })
  async book(@Req() req: Request, @Body() body: BookAppointmentDto) {
    const result = await this.availabilitySvc.bookSlot(
      patientId(req),
      body.departmentDisplay,
      body.appointmentType,
      body.clinicianDisplay ?? null,
      body.slotStart,
    );
    await writeAuditEvent(this.pool, {
      actor_id: null,
      actor_role: null,
      action: "PATIENT_SELF_SERVICE_APPOINTMENT_BOOKED",
      target_type: "appointment",
      target_id: result.id,
      outcome: "SUCCESS",
      metadata_json: { patient_id: patientId(req), department_display: result.department_display },
      request_id: (req.requestId ?? uuidv4()) as RequestId,
    });
    return result;
  }

  @Get("appointments")
  @ApiOperation({ summary: "List the caller's own upcoming appointments" })
  async myAppointments(@Req() req: Request) {
    return { data: await this.appointmentSvc.listOwn(patientId(req)) };
  }

  @Patch("appointments/:id/cancel")
  @ApiOperation({ summary: "Cancel the caller's own appointment" })
  async cancel(@Req() req: Request, @Param("id") id: string) {
    const result = await this.appointmentSvc.selfServiceCancel(id, patientId(req));
    await writeAuditEvent(this.pool, {
      actor_id: null,
      actor_role: null,
      action: "PATIENT_SELF_SERVICE_APPOINTMENT_CANCELLED",
      target_type: "appointment",
      target_id: id,
      outcome: "SUCCESS",
      metadata_json: { patient_id: patientId(req) },
      request_id: (req.requestId ?? uuidv4()) as RequestId,
    });
    return result;
  }
}
