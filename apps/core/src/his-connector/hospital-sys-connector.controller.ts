/**
 * HospitalSysConnectorController — dummy/stub HIS transmission endpoints.
 * See hospital-sys-connector.service.ts and docs/architecture/his-connector-hospital-sys.md.
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
import { HospitalSysConnectorService, type TransmissionSourceType } from "./hospital-sys-connector.service";

class TransmitDto {
  @IsIn(["service_request", "refill_request"])
  sourceType!: TransmissionSourceType;

  @IsUUID()
  sourceId!: string;
}

function uid(req: Request): string {
  const u = req.authenticatedUserId;
  if (!u) throw new Error("No authenticatedUserId on request");
  return u;
}

@ApiTags("his-connector")
@ApiCookieAuth("session_id")
@UseGuards(RbacGuard)
@Controller()
export class HospitalSysConnectorController {
  constructor(
    private readonly svc: HospitalSysConnectorService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Post("patients/:id/his-connector/transmit")
  @RequirePermission("his_transmission:write")
  @ApiOperation({
    summary:
      "Transmit a clinician-confirmed order/refill to the hospital HIS for its own safety validation (dummy/stub — see docs)",
  })
  async transmit(@Req() req: Request, @Param("id") id: string, @Body() body: TransmitDto) {
    const result = await this.svc.transmit(uid(req), id, body.sourceType, body.sourceId);
    await writeAuditEvent(this.pool, {
      actor_id: uid(req) as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "HIS_TRANSMISSION_SENT",
      target_type: "his_order_transmission",
      target_id: result.id,
      outcome: "SUCCESS",
      metadata_json: { source_type: result.source_type, source_id: result.source_id, status: result.status },
      request_id: (req.requestId ?? uuidv4()) as RequestId,
    });
    return result;
  }

  @Get("patients/:id/his-connector/transmissions")
  @RequirePermission("patient:read")
  @ApiOperation({ summary: "List HIS transmission history for a patient" })
  async list(@Req() req: Request, @Param("id") id: string) {
    return { data: await this.svc.list(uid(req), id) };
  }
}
