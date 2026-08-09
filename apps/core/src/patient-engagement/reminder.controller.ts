/**
 * ReminderController — dummy/stub reminder-send routes.
 * See reminder-connector.service.ts and docs/architecture/patient-engagement-connector.md.
 */
import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { v4 as uuidv4 } from "uuid";
import { IsIn, IsUUID } from "class-validator";
import { RbacGuard, RequirePermission } from "../rbac/rbac.guard";
import { writeAuditEvent } from "@clinical-copilot/audit";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";
import type { RequestId, UserId, UserRole } from "@clinical-copilot/shared-types";
import { PatientEngagementConnectorService, type ReminderChannel } from "./reminder-connector.service";

class SendReminderDto {
  @IsUUID()
  appointmentId!: string;

  @IsIn(["sms", "email", "whatsapp"])
  channel!: ReminderChannel;
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
export class ReminderController {
  constructor(
    private readonly svc: PatientEngagementConnectorService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Post("patients/:id/reminders")
  @RequirePermission("reminder:send")
  @ApiOperation({ summary: "Send an appointment reminder (dummy/stub -- see docs)" })
  async send(@Req() req: Request, @Param("id") id: string, @Body() body: SendReminderDto) {
    const result = await this.svc.send(uid(req), id, body.appointmentId, body.channel);
    await writeAuditEvent(this.pool, {
      actor_id: uid(req) as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "REMINDER_SENT",
      target_type: "reminder_send",
      target_id: result.id,
      outcome: "SUCCESS",
      metadata_json: { patient_id: id, appointment_id: result.appointment_id, channel: result.channel, status: result.status },
      request_id: (req.requestId ?? uuidv4()) as RequestId,
    });
    return result;
  }

  @Get("patients/:id/reminders")
  @RequirePermission("patient:read")
  @ApiOperation({ summary: "List reminder-send history for a patient" })
  async list(@Req() req: Request, @Param("id") id: string) {
    return { data: await this.svc.list(uid(req), id) };
  }
}
