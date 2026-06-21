import { Controller, Get, Post, Param, Query, Body, Req, UseGuards, Inject, HttpCode } from "@nestjs/common";
import type { Request } from "express";
import { ApiTags, ApiOperation, ApiCookieAuth } from "@nestjs/swagger";
import { IsString, IsOptional, IsIn } from "class-validator";
import type { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { RbacGuard, RequirePermission } from "../rbac/rbac.guard";
import { PG_POOL } from "../database/database.module";
import { writeAuditEvent } from "@clinical-copilot/audit";
import type { UserId, UserRole, RequestId } from "@clinical-copilot/shared-types";
import { ConditionService } from "./condition.service";

class AddConditionDto {
  @IsString() code!: string;
  @IsString() code_display!: string;
  @IsOptional() @IsString() @IsIn(["active", "resolved"]) status?: string;
  @IsOptional() @IsString() onset_date?: string;
}

function uid(req: Request): string {
  const id = req.authenticatedUserId;
  if (!id) throw new Error("No authenticatedUserId");
  return id;
}

@ApiTags("conditions")
@ApiCookieAuth("session_id")
@UseGuards(RbacGuard)
@RequirePermission("condition:write")
@Controller()
export class ConditionController {
  constructor(
    private readonly conditions: ConditionService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Get("conditions/suggest")
  @ApiOperation({ summary: "Suggest SNOMED coded terms for a diagnosis (clinician confirms)" })
  suggest(@Query("q") q: string) {
    return { suggestions: this.conditions.suggest((q ?? "").toString()) };
  }

  @Post("patients/:id/conditions")
  @HttpCode(201)
  @ApiOperation({ summary: "Add a clinician-confirmed diagnosis to the problem list" })
  async add(@Req() req: Request, @Param("id") id: string, @Body() body: AddConditionDto) {
    const result = await this.conditions.add(uid(req), id, body);
    // Audit codes only (no free-text), per §7.
    await writeAuditEvent(this.pool, {
      actor_id: uid(req) as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "CONDITION_ADDED",
      target_type: "patient",
      target_id: id,
      outcome: "SUCCESS",
      metadata_json: { code: result.code, status: result.status, source: "clinician-entry" },
      request_id: (req.requestId ?? uuidv4()) as RequestId,
    });
    return result;
  }
}
