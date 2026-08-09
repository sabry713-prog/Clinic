/**
 * ProviderAvailabilityController — admin-only CRUD for the recurring weekly
 * availability windows that back AI Receptionist slot generation. Staff-
 * facing, RBAC-gated -- distinct from every other route in this module,
 * which is public/patient-session-gated.
 */
import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { v4 as uuidv4 } from "uuid";
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from "class-validator";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { RbacGuard, RequirePermission } from "../rbac/rbac.guard";
import { writeAuditEvent } from "@clinical-copilot/audit";
import type { RequestId, UserId, UserRole } from "@clinical-copilot/shared-types";
import { ProviderAvailabilityService } from "./provider-availability.service";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

class CreateProviderAvailabilityDto {
  @IsString()
  departmentDisplay!: string;

  @IsOptional()
  @IsString()
  clinicianDisplay?: string;

  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @Matches(TIME_RE, { message: "Expected HH:MM or HH:MM:SS" })
  startTime!: string;

  @Matches(TIME_RE, { message: "Expected HH:MM or HH:MM:SS" })
  endTime!: string;

  @IsInt()
  @Min(1)
  slotDurationMinutes!: number;
}

class UpdateActiveDto {
  @IsBoolean()
  active!: boolean;
}

function uid(req: Request): string {
  const u = req.authenticatedUserId;
  if (!u) throw new Error("No authenticatedUserId on request");
  return u;
}

@ApiTags("ai-receptionist")
@ApiCookieAuth("session_id")
@UseGuards(RbacGuard)
@Controller("admin/provider-availability")
export class ProviderAvailabilityController {
  constructor(
    private readonly svc: ProviderAvailabilityService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  private async audit(req: Request, action: string, targetId: string | null, meta: Record<string, unknown>): Promise<void> {
    await writeAuditEvent(this.pool, {
      actor_id: uid(req) as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action,
      target_type: "provider_availability",
      target_id: targetId,
      outcome: "SUCCESS",
      metadata_json: meta,
      request_id: (req.requestId ?? uuidv4()) as RequestId,
    });
  }

  @Get()
  @RequirePermission("provider_availability:manage")
  @ApiOperation({ summary: "List all provider availability windows" })
  async list() {
    return { data: await this.svc.list() };
  }

  @Post()
  @RequirePermission("provider_availability:manage")
  @ApiOperation({ summary: "Create a recurring weekly availability window" })
  async create(@Req() req: Request, @Body() body: CreateProviderAvailabilityDto) {
    const result = await this.svc.create(
      uid(req),
      body.departmentDisplay,
      body.clinicianDisplay ?? null,
      body.dayOfWeek,
      body.startTime,
      body.endTime,
      body.slotDurationMinutes,
    );
    await this.audit(req, "PROVIDER_AVAILABILITY_CREATED", result.id, { department_display: result.department_display });
    return result;
  }

  @Patch(":id/active")
  @RequirePermission("provider_availability:manage")
  @ApiOperation({ summary: "Activate or deactivate an availability window" })
  async setActive(@Req() req: Request, @Param("id") id: string, @Body() body: UpdateActiveDto) {
    const result = await this.svc.setActive(id, body.active);
    await this.audit(req, "PROVIDER_AVAILABILITY_STATUS_CHANGED", id, { active: body.active });
    return result;
  }
}
