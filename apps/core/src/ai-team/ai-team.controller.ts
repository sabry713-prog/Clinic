/**
 * AiTeamController
 *
 * Exposes:
 *   GET /api/v1/patients/:id/ai-team/stream  (SSE)
 *
 * Constraints:
 * - Checks patient scope before opening the stream (same guarantee as every
 *   other patient-scoped route -- an out-of-scope patient never sees a
 *   stream open, not even a rejected one after the fact).
 * - Writes AI_TEAM_STREAM_OPENED audit event (patient_id only -- no
 *   clinical content, no agent output, PHI-adjacent).
 */

import { Controller, Sse, Param, Req, UseGuards, Logger, Inject } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import type { Request } from "express";
import type { Observable } from "rxjs";
import { ApiOperation, ApiTags, ApiCookieAuth } from "@nestjs/swagger";
import { AiTeamService } from "./ai-team.service";
import { PatientScopeService } from "../patient/patient-scope.service";
import { RbacGuard, RequirePermission } from "../rbac/rbac.guard";
import { writeAuditEvent } from "@clinical-copilot/audit";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";

function getRequestingUserId(req: Request): string {
  const uid = req.authenticatedUserId;
  if (!uid) throw new Error("No authenticatedUserId on request");
  return uid;
}

@ApiTags("ai-team")
@ApiCookieAuth("session_id")
@UseGuards(RbacGuard)
@RequirePermission("narrative:generate")
@Controller("patients/:id/ai-team")
export class AiTeamController {
  private readonly logger = new Logger(AiTeamController.name);

  constructor(
    private readonly aiTeamService: AiTeamService,
    private readonly scopeService: PatientScopeService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Sse("stream")
  @ApiOperation({
    summary:
      "Stream live AI Team agent updates (Pharmacist/Consultant/NPHIES), grounded in NSCRE " +
      "(services/veritas-graph, Sprint 7) and formatted by DeepSeek (services/orchestrator, Sprint 8)",
  })
  async stream(@Param("id") patientId: string, @Req() req: Request): Promise<Observable<MessageEvent>> {
    const userId = getRequestingUserId(req);
    await this.scopeService.assertPatientInScope(userId, patientId);

    // Audit event (agent output/prose not in audit metadata -- PHI-adjacent).
    await writeAuditEvent(this.pool, {
      actor_id: userId as import("@clinical-copilot/shared-types").UserId,
      actor_role: null,
      action: "AI_TEAM_STREAM_OPENED",
      target_type: "patient",
      target_id: patientId as import("@clinical-copilot/shared-types").PatientId,
      outcome: "SUCCESS",
      metadata_json: {},
      request_id: (req.headers["x-request-id"] as string | undefined ?? null) as import("@clinical-copilot/shared-types").RequestId | null,
    });

    return this.aiTeamService.streamAgents(patientId);
  }
}
