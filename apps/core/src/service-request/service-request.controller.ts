import {
  Controller, Get, Post, Param, Body, Req, UseGuards, HttpCode, Inject,
} from "@nestjs/common";
import type { Request } from "express";
import { ApiTags, ApiCookieAuth, ApiOperation } from "@nestjs/swagger";
import { v4 as uuidv4 } from "uuid";
import { IsArray } from "class-validator";
import { RbacGuard, RequirePermission } from "../rbac/rbac.guard";
import { writeAuditEvent } from "@clinical-copilot/audit";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";
import type { UserId, UserRole, RequestId } from "@clinical-copilot/shared-types";
import { ServiceRequestService, type ServiceCandidate } from "./service-request.service";

class ConfirmDto {
  // Items are clinician-confirmed candidates returned by the /candidates
  // endpoint (verbatim extractions); each is re-inserted as an order.
  @IsArray()
  items!: ServiceCandidate[];
}

function uid(req: Request): string {
  const u = req.authenticatedUserId;
  if (!u) throw new Error("No authenticatedUserId on request");
  return u;
}

@ApiTags("service-requests")
@ApiCookieAuth("session_id")
@UseGuards(RbacGuard)
@Controller()
export class ServiceRequestController {
  constructor(
    private readonly svc: ServiceRequestService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  private async audit(req: Request, action: string, targetId: string | null, meta: Record<string, unknown>): Promise<void> {
    await writeAuditEvent(this.pool, {
      actor_id: uid(req) as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action,
      target_type: "service_request",
      target_id: targetId,
      outcome: "SUCCESS",
      metadata_json: meta,
      request_id: (req.requestId ?? uuidv4()) as RequestId,
    });
  }

  @Get("patients/:id/service-requests/candidates")
  @RequirePermission("patient:read")
  @ApiOperation({ summary: "Extract candidate service requests from documented orders (nothing created)" })
  async candidates(@Req() req: Request, @Param("id") id: string) {
    const data = await this.svc.extractCandidates(uid(req), id);
    await this.audit(req, "SERVICE_REQUEST_EXTRACTED", id, { count: data.length });
    return { data };
  }

  @Post("patients/:id/service-requests")
  @HttpCode(201)
  @RequirePermission("service_request:write")
  @ApiOperation({ summary: "Create service requests from clinician-confirmed candidates" })
  async create(@Req() req: Request, @Param("id") id: string, @Body() body: ConfirmDto) {
    const created = await this.svc.confirmAndCreate(uid(req), id, body.items as ServiceCandidate[]);
    await this.audit(req, "SERVICE_REQUEST_CREATED", id, {
      count: created.length,
      codes: created.map((c) => c.code_display),
    });
    return { data: created };
  }

  @Get("patients/:id/service-requests")
  @RequirePermission("patient:read")
  @ApiOperation({ summary: "List the patient's service requests" })
  async list(@Req() req: Request, @Param("id") id: string) {
    return { data: await this.svc.list(uid(req), id) };
  }
}
