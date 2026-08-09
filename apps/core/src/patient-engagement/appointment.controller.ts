/**
 * AppointmentController — Patient Engagement scheduling routes.
 * See appointment.service.ts and docs/architecture/patient-engagement-connector.md.
 *
 * Patient-scoped routes (schedule/list/status) sit under patients/:id/...,
 * same pattern as service-request/refill-request. The front-desk queue is
 * deliberately NOT patient-scoped -- administrative cross-patient
 * aggregation, same reasoning as the pharmacist refill queue.
 */
import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { v4 as uuidv4 } from "uuid";
import { IsIn, IsISO8601, IsOptional, IsString } from "class-validator";
import { RbacGuard, RequirePermission } from "../rbac/rbac.guard";
import { writeAuditEvent } from "@clinical-copilot/audit";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";
import type { RequestId, UserId, UserRole } from "@clinical-copilot/shared-types";
import { AppointmentService, type AppointmentStatus } from "./appointment.service";

class ScheduleAppointmentDto {
  @IsISO8601()
  scheduledAt!: string;

  @IsString()
  appointmentType!: string;

  @IsOptional()
  @IsString()
  departmentDisplay?: string;

  @IsOptional()
  @IsString()
  clinicianDisplay?: string;
}

class UpdateAppointmentStatusDto {
  @IsIn(["completed", "cancelled", "no_show"])
  status!: AppointmentStatus;
}

function uid(req: Request): string {
  const u = req.authenticatedUserId;
  if (!u) throw new Error("No authenticatedUserId on request");
  return u;
}

@ApiTags("patient-engagement")
@ApiCookieAuth("session_id")
@UseGuards(RbacGuard)
@Controller()
export class AppointmentController {
  constructor(
    private readonly svc: AppointmentService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  private async audit(req: Request, action: string, targetId: string | null, meta: Record<string, unknown>): Promise<void> {
    await writeAuditEvent(this.pool, {
      actor_id: uid(req) as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action,
      target_type: "appointment",
      target_id: targetId,
      outcome: "SUCCESS",
      metadata_json: meta,
      request_id: (req.requestId ?? uuidv4()) as RequestId,
    });
  }

  @Post("patients/:id/appointments")
  @RequirePermission("appointment:write")
  @ApiOperation({ summary: "Schedule an appointment for a patient (administrative scheduling fact only)" })
  async schedule(@Req() req: Request, @Param("id") id: string, @Body() body: ScheduleAppointmentDto) {
    const result = await this.svc.schedule(
      uid(req),
      id,
      body.scheduledAt,
      body.appointmentType,
      body.departmentDisplay ?? null,
      body.clinicianDisplay ?? null,
    );
    await this.audit(req, "APPOINTMENT_SCHEDULED", result.id, { patient_id: id, appointment_type: result.appointment_type });
    return result;
  }

  @Get("patients/:id/appointments")
  @RequirePermission("patient:read")
  @ApiOperation({ summary: "List appointments for a patient" })
  async list(@Req() req: Request, @Param("id") id: string) {
    return { data: await this.svc.list(uid(req), id) };
  }

  @Patch("patients/:id/appointments/:appointmentId")
  @RequirePermission("appointment:write")
  @ApiOperation({ summary: "Update an appointment's status (completed / cancelled / no_show)" })
  async updateStatus(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("appointmentId") appointmentId: string,
    @Body() body: UpdateAppointmentStatusDto,
  ) {
    const result = await this.svc.updateStatus(uid(req), appointmentId, body.status);
    await this.audit(req, "APPOINTMENT_STATUS_CHANGED", appointmentId, { patient_id: id, new_status: result.status });
    return result;
  }

  @Get("front-desk/appointments")
  @RequirePermission("appointment:write")
  @ApiOperation({ summary: "Front-desk queue -- scheduled appointments across patients (administrative fields only)" })
  async queue(@Req() req: Request, @Query("date") date?: string) {
    const data = await this.svc.queue(date);
    await this.audit(req, "APPOINTMENT_QUEUE_VIEW", null, { count: data.length, date: date ?? null });
    return { data };
  }

  @Patch("front-desk/appointments/:appointmentId")
  @RequirePermission("appointment:write")
  @ApiOperation({ summary: "Update an appointment's status from the front-desk queue" })
  async queueUpdateStatus(
    @Req() req: Request,
    @Param("appointmentId") appointmentId: string,
    @Body() body: UpdateAppointmentStatusDto,
  ) {
    const result = await this.svc.updateStatus(uid(req), appointmentId, body.status);
    await this.audit(req, "APPOINTMENT_STATUS_CHANGED", appointmentId, { new_status: result.status, via: "front_desk_queue" });
    return result;
  }
}
