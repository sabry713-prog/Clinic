/**
 * RefillRequestController — pharmacy operational tasks (gray-area).
 *
 * Patient-scoped routes (create/list/cancel) sit under patients/:id/...,
 * same pattern as service-request. The pharmacist queue and status-update
 * routes are deliberately NOT patient-scoped — administrative cross-patient
 * aggregation, same reasoning as the NPHIES rejection-analytics dashboard.
 */
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { v4 as uuidv4 } from "uuid";
import { IsIn, IsOptional, IsString, IsUUID } from "class-validator";
import { RbacGuard, RequirePermission } from "../rbac/rbac.guard";
import { writeAuditEvent } from "@clinical-copilot/audit";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";
import type { RequestId, UserId, UserRole } from "@clinical-copilot/shared-types";
import { RefillRequestService, type RefillStatus } from "./refill-request.service";

class CreateRefillDto {
  @IsUUID()
  medicationRequestId!: string;
}

class UpdateRefillStatusDto {
  @IsIn(["routed", "filled", "denied"])
  status!: RefillStatus;

  @IsOptional()
  @IsString()
  pharmacyNote?: string;
}

function uid(req: Request): string {
  const u = req.authenticatedUserId;
  if (!u) throw new Error("No authenticatedUserId on request");
  return u;
}

@ApiTags("refill-requests")
@ApiCookieAuth("session_id")
@UseGuards(RbacGuard)
@Controller()
export class RefillRequestController {
  constructor(
    private readonly svc: RefillRequestService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  private async audit(req: Request, action: string, targetId: string | null, meta: Record<string, unknown>): Promise<void> {
    await writeAuditEvent(this.pool, {
      actor_id: uid(req) as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action,
      target_type: "refill_request",
      target_id: targetId,
      outcome: "SUCCESS",
      metadata_json: meta,
      request_id: (req.requestId ?? uuidv4()) as RequestId,
    });
  }

  @Post("patients/:id/refill-requests")
  @HttpCode(201)
  @RequirePermission("refill_request:write")
  @ApiOperation({ summary: "Request a refill for an already-active, already-documented medication" })
  async create(@Req() req: Request, @Param("id") id: string, @Body() body: CreateRefillDto) {
    const result = await this.svc.create(uid(req), id, body.medicationRequestId);
    await this.audit(req, "REFILL_REQUEST_CREATED", result.id, {
      patient_id: id,
      medication_display: result.medication_display,
    });
    return result;
  }

  @Get("patients/:id/refill-requests")
  @RequirePermission("patient:read")
  @ApiOperation({ summary: "List refill requests for a patient" })
  async list(@Req() req: Request, @Param("id") id: string) {
    return { data: await this.svc.list(uid(req), id) };
  }

  @Delete("patients/:id/refill-requests/:refillId")
  @RequirePermission("refill_request:write")
  @ApiOperation({ summary: "Cancel a refill request (original requester only, while still 'requested')" })
  async cancel(@Req() req: Request, @Param("id") id: string, @Param("refillId") refillId: string) {
    const result = await this.svc.cancel(uid(req), refillId);
    await this.audit(req, "REFILL_REQUEST_CANCELLED", refillId, { patient_id: id });
    return result;
  }

  @Get("pharmacy/refill-queue")
  @RequirePermission("refill_request:fulfill")
  @ApiOperation({
    summary: "Pharmacist queue — open refill requests across patients (administrative fields only)",
  })
  async queue(@Req() req: Request) {
    const data = await this.svc.queue();
    await this.audit(req, "REFILL_QUEUE_VIEW", null, { count: data.length });
    return { data };
  }

  @Patch("pharmacy/refill-requests/:refillId")
  @RequirePermission("refill_request:fulfill")
  @ApiOperation({ summary: "Route, fill, or deny a refill request (status only — no dose/interaction check)" })
  async updateStatus(
    @Req() req: Request,
    @Param("refillId") refillId: string,
    @Body() body: UpdateRefillStatusDto,
  ) {
    const result = await this.svc.updateStatus(uid(req), refillId, body.status, body.pharmacyNote);
    await this.audit(req, "REFILL_REQUEST_STATUS_CHANGED", refillId, {
      new_status: result.status,
      has_note: Boolean(body.pharmacyNote),
    });
    return result;
  }
}
