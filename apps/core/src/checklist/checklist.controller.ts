import { Controller, Get, Put, Param, Query, Body, Req, UseGuards, Inject, HttpCode } from "@nestjs/common";
import type { Request } from "express";
import { ApiTags, ApiOperation, ApiCookieAuth } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import type { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { RbacGuard, RequirePermission } from "../rbac/rbac.guard";
import { PG_POOL } from "../database/database.module";
import { writeAuditEvent } from "@clinical-copilot/audit";
import type { UserId, UserRole, RequestId } from "@clinical-copilot/shared-types";
import { ChecklistService, type ChecklistState } from "./checklist.service";

class SetChecklistDto {
  @IsString()
  @MaxLength(200)
  item_id!: string;

  // null clears the decision (see ChecklistService.set): a stored row means the clinician decided.
  @IsOptional()
  @IsIn(["done", "dismissed", null])
  state?: ChecklistState | null;

  /**
   * The text of a row the clinician typed. Catalog rows omit it -- their text lives in the catalogs
   * both sides already hold.
   *
   * It is deliberately NOT written to the audit event below: the audit contract excludes free text
   * (see the comment there), and this is the clinician's own wording. The row is recorded; the words
   * stay in the checklist table where they belong.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}

function uid(req: Request): string {
  const id = req.authenticatedUserId;
  if (!id) throw new Error("No authenticatedUserId");
  return id;
}

@ApiTags("checklist")
@ApiCookieAuth("session_id")
@UseGuards(RbacGuard)
// The checklist is the physician's own documentation state, so it rides on the permission that
// already means "this clinician documents findings". Inventing a permission for it would widen the
// RBAC surface for a table that only the ordering physician touches.
@RequirePermission("condition:write")
@Controller()
export class ChecklistController {
  constructor(
    private readonly checklist: ChecklistService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Get("patients/:id/checklist")
  @ApiOperation({ summary: "The clinician's checklist decisions for one encounter" })
  async list(@Req() req: Request, @Param("id") id: string, @Query("encounter_id") encounterId: string) {
    return { data: await this.checklist.list(uid(req), id, (encounterId ?? "").toString()) };
  }

  @Put("patients/:id/checklist")
  @HttpCode(200)
  @ApiOperation({ summary: "Set or clear one checklist decision (done / dismissed / cleared)" })
  async set(@Req() req: Request, @Param("id") id: string, @Query("encounter_id") encounterId: string, @Body() body: SetChecklistDto) {
    await this.checklist.set(uid(req), id, (encounterId ?? "").toString(), body.item_id, body.state ?? null, body.label ?? null);
    // The decision itself, not the note: no clinical content, no free text (audit contract §7).
    await writeAuditEvent(this.pool, {
      actor_id: uid(req) as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "CHECKLIST_DECISION_SET",
      target_type: "patient",
      target_id: id,
      outcome: "SUCCESS",
      metadata_json: { item_id: body.item_id, state: body.state ?? "cleared" },
      request_id: (req.requestId ?? uuidv4()) as RequestId,
    });
  }
}
