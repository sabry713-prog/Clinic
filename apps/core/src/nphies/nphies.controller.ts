/**
 * NphiesController — claim-readiness endpoint.
 *
 * GET /patients/:id/nphies/claim-readiness
 * Deterministic administrative validation only (see ClaimReadinessService).
 */

import { Controller, Get, Inject, Param, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { v4 as uuidv4 } from "uuid";
import { RbacGuard, RequirePermission } from "../rbac/rbac.guard";
import { writeAuditEvent } from "@clinical-copilot/audit";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";
import type { RequestId, UserId, UserRole } from "@clinical-copilot/shared-types";
import { ClaimReadinessService } from "./claim-readiness.service";

function uid(req: Request): string {
  const u = req.authenticatedUserId;
  if (!u) throw new Error("No authenticatedUserId on request");
  return u;
}

@ApiTags("nphies")
@ApiCookieAuth("session_id")
@UseGuards(RbacGuard)
@Controller()
export class NphiesController {
  constructor(
    private readonly readiness: ClaimReadinessService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Get("patients/:id/nphies/claim-readiness")
  @RequirePermission("patient:read")
  @ApiOperation({
    summary:
      "Deterministic NPHIES claim-completeness checks for a patient (administrative only)",
  })
  async claimReadiness(@Req() req: Request, @Param("id") patientId: string) {
    const result = await this.readiness.evaluate(uid(req), patientId);

    await writeAuditEvent(this.pool, {
      actor_id: uid(req) as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "NPHIES_CLAIM_READINESS_VIEW",
      target_type: "patient",
      target_id: patientId,
      outcome: "SUCCESS",
      metadata_json: { overall: result.overall, checks: result.checks.length },
      request_id: (req.requestId ?? uuidv4()) as RequestId,
    });

    return result;
  }
}
