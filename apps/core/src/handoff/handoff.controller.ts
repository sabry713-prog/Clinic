/**
 * Handoff endpoints
 *
 * POST /api/v1/patients/:id/handoff  -- single-patient handoff
 * POST /api/v1/wards/:ward_id/handoff -- ward handoff (≤ 20 patients)
 */

import {
  Controller,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  Logger,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";
import type { Request } from "express";
import { RbacGuard, RequirePermission } from "../rbac/rbac.guard";
import { HandoffService, type HandoffScope } from "./handoff.service";
import { writeAuditEvent } from "@clinical-copilot/audit";
import type { UserId, UserRole, RequestId } from "@clinical-copilot/shared-types";
import { Inject } from "@nestjs/common";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";

class HandoffRequestDto {
  @IsIn(["current_shift", "last_24h"])
  @IsOptional()
  scope?: HandoffScope;

  @IsIn(["en", "ar"])
  @IsOptional()
  language?: "en" | "ar";
}

@ApiTags("handoff")
@Controller()
@UseGuards(RbacGuard)
export class HandoffController {
  private readonly logger = new Logger(HandoffController.name);

  constructor(
    private readonly handoffService: HandoffService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Post("patients/:id/handoff")
  @HttpCode(200)
  @RequirePermission("handoff:generate")
  @ApiOperation({ summary: "Generate handoff summary for a single patient" })
  async generatePatientHandoff(
    @Req() req: Request,
    @Param("id") patientId: string,
    @Body() body: HandoffRequestDto,
  ) {
    const userId = req.authenticatedUserId ?? "";
    const requestId = uuidv4() as RequestId;

    const result = await this.handoffService.generateForPatient({
      patientId,
      userId,
      scope: body.scope ?? "current_shift",
      language: body.language ?? "en",
    });

    await writeAuditEvent(this.pool, {
      actor_id: userId as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "HANDOFF_GENERATE",
      target_type: "patient",
      target_id: patientId,
      outcome: "SUCCESS",
      metadata_json: { handoff_id: result.id, scope: result.scope, language: result.language },
      request_id: requestId,
    });

    return result;
  }

  @Post("wards/:ward_id/handoff")
  @HttpCode(200)
  @RequirePermission("handoff:generate")
  @ApiOperation({ summary: "Generate handoff summaries for all patients in a ward" })
  async generateWardHandoff(
    @Req() req: Request,
    @Param("ward_id") wardId: string,
    @Body() body: HandoffRequestDto,
  ) {
    const userId = req.authenticatedUserId ?? "";
    const requestId = uuidv4() as RequestId;

    const result = await this.handoffService.generateForWard({
      wardId,
      userId,
      scope: body.scope ?? "current_shift",
      language: body.language ?? "en",
    });

    await writeAuditEvent(this.pool, {
      actor_id: userId as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "HANDOFF_GENERATE",
      target_type: "ward",
      target_id: wardId,
      outcome: "SUCCESS",
      metadata_json: { scope: result.scope, language: result.language, patient_count: result.patient_count },
      request_id: requestId,
    });

    return result;
  }
}
