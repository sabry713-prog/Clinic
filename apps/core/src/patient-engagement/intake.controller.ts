/**
 * IntakeController — staff-assisted check-in intake routes.
 * See intake.service.ts and docs/architecture/patient-engagement-connector.md.
 */
import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { v4 as uuidv4 } from "uuid";
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID } from "class-validator";
import { RbacGuard, RequirePermission } from "../rbac/rbac.guard";
import { writeAuditEvent } from "@clinical-copilot/audit";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";
import type { RequestId, UserId, UserRole } from "@clinical-copilot/shared-types";
import { IntakeService } from "./intake.service";

class CaptureIntakeDto {
  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @IsBoolean()
  contactConfirmed!: boolean;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsOptional()
  @IsIn(["sms", "email", "whatsapp"])
  preferredChannel?: string;

  @IsOptional()
  @IsString()
  reasonForVisitText?: string;
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
export class IntakeController {
  constructor(
    private readonly svc: IntakeService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Get("patients/:id/contact")
  @RequirePermission("patient:read")
  @ApiOperation({ summary: "Get the patient's confirmed contact info (prefills the intake form)" })
  async getContact(@Req() req: Request, @Param("id") id: string) {
    return { data: await this.svc.getContact(uid(req), id) };
  }

  @Post("patients/:id/intake")
  @RequirePermission("intake:write")
  @ApiOperation({ summary: "Capture staff-assisted check-in intake (contact confirmation + verbatim reason for visit)" })
  async capture(@Req() req: Request, @Param("id") id: string, @Body() body: CaptureIntakeDto) {
    const result = await this.svc.capture(uid(req), id, {
      appointmentId: body.appointmentId ?? null,
      contactConfirmed: body.contactConfirmed,
      contactPhone: body.contactPhone ?? null,
      contactEmail: body.contactEmail ?? null,
      preferredChannel: body.preferredChannel ?? null,
      reasonForVisitText: body.reasonForVisitText ?? null,
    });
    await writeAuditEvent(this.pool, {
      actor_id: uid(req) as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "INTAKE_RECORDED",
      target_type: "intake_record",
      target_id: result.id,
      outcome: "SUCCESS",
      metadata_json: { patient_id: id, contact_confirmed: result.contact_confirmed },
      request_id: (req.requestId ?? uuidv4()) as RequestId,
    });
    return result;
  }

  @Get("patients/:id/intake")
  @RequirePermission("patient:read")
  @ApiOperation({ summary: "List intake capture history for a patient" })
  async list(@Req() req: Request, @Param("id") id: string) {
    return { data: await this.svc.list(uid(req), id) };
  }
}
