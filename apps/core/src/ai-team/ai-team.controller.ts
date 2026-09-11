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

import { Body, Controller, Post, Sse, Param, Req, UseGuards, Logger, Inject } from "@nestjs/common";
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

  /**
   * Run the Sprint 10 inter-agent handoff chain.
   *
   * Route note: the Phase 2 spec named this `/api/v1/ai-team/handoff-chain`
   * (no patient in the path). It is mounted under `patients/:id/ai-team`
   * instead so it inherits the same patient-scope check, RBAC guard and audit
   * trail as every other patient-scoped route here. A non-scoped variant would
   * let any authenticated user run the chain against any patient id in the
   * body, which is the exact check this controller exists to enforce.
   */
  @Post("handoff-chain")
  @ApiOperation({
    summary:
      "Run the inter-agent handoff chain (NSCRE critical finding -> Consultant -> " +
      "Pharmacist -> NPHIES -> Scribe). Empty when the graph reports no critical finding.",
  })
  async handoffChain(
    @Param("id") patientId: string,
    @Req() req: Request,
  ): Promise<{ patient_id: string; handoffs: unknown[] }> {
    const userId = getRequestingUserId(req);
    await this.scopeService.assertPatientInScope(userId, patientId);

    const result = await this.aiTeamService.runHandoffChain(patientId);

    // Count only -- handoff payloads carry clinical content (PHI-adjacent).
    await writeAuditEvent(this.pool, {
      actor_id: userId as import("@clinical-copilot/shared-types").UserId,
      actor_role: null,
      action: "AI_TEAM_HANDOFF_CHAIN_RUN",
      target_type: "patient",
      target_id: patientId as import("@clinical-copilot/shared-types").PatientId,
      outcome: "SUCCESS",
      metadata_json: { handoff_count: result.handoffs.length },
      request_id: (req.headers["x-request-id"] as string | undefined ?? null) as import("@clinical-copilot/shared-types").RequestId | null,
    });

    return result;
  }

  /**
   * Draft the post-encounter package from a finalized discharge order.
   * Nothing is booked and nothing is sent -- every item comes back as a draft
   * for clinician review.
   */
  @Post("post-care")
  @ApiOperation({
    summary:
      "Draft post-encounter follow-up slots, patient care instructions, lab prep " +
      "and outreach payloads. All drafts -- nothing is booked or sent.",
  })
  async postCare(
    @Param("id") patientId: string,
    @Body() body: { discharge_order?: unknown },
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const userId = getRequestingUserId(req);
    await this.scopeService.assertPatientInScope(userId, patientId);

    const result = await this.aiTeamService.postCare(patientId, body?.discharge_order);

    await writeAuditEvent(this.pool, {
      actor_id: userId as import("@clinical-copilot/shared-types").UserId,
      actor_role: null,
      action: "AI_TEAM_POST_CARE_DRAFTED",
      target_type: "patient",
      target_id: patientId as import("@clinical-copilot/shared-types").PatientId,
      outcome: "SUCCESS",
      metadata_json: {
        slot_count: Array.isArray(result["followup_slots"]) ? (result["followup_slots"] as unknown[]).length : 0,
        payload_count: Array.isArray(result["dispatch_payloads"]) ? (result["dispatch_payloads"] as unknown[]).length : 0,
      },
      request_id: (req.headers["x-request-id"] as string | undefined ?? null) as import("@clinical-copilot/shared-types").RequestId | null,
    });

    return result;
  }

  /**
   * Generate a SOAP note from the encounter transcript.
   * Formatting-only: DeepSeek structures the raw transcript into the four
   * SOAP sections without interpreting clinical data (Non-SaMD Health IT,
   * SFDA MDS-G027).
   */
  @Post("soap")
  @ApiOperation({
    summary:
      "Generate a SOAP note (Subjective, Objective, Assessment, Plan) from " +
      "the encounter transcript via the orchestrator's DeepSeek formatting engine.",
  })
  async generateSoap(
    @Param("id") patientId: string,
    @Body() body: { transcript: string },
    @Req() req: Request,
  ): Promise<Record<string, string>> {
    const userId = getRequestingUserId(req);
    await this.scopeService.assertPatientInScope(userId, patientId);

    const result = await this.aiTeamService.generateSoap(patientId, body.transcript);

    await writeAuditEvent(this.pool, {
      actor_id: userId as import("@clinical-copilot/shared-types").UserId,
      actor_role: null,
      action: "AI_TEAM_SOAP_GENERATED",
      target_type: "patient",
      target_id: patientId as import("@clinical-copilot/shared-types").PatientId,
      outcome: "SUCCESS",
      metadata_json: {},
      request_id: (req.headers["x-request-id"] as string | undefined ?? null) as import("@clinical-copilot/shared-types").RequestId | null,
    });

    return result;
  }

  /**
   * Extract the clinician's own stated action items from the transcript
   * (LLM-assisted smart-checklist proposals). Extraction-only: the model
   * lifts items the clinician explicitly said; the orchestrator verifies
   * each item's supporting quote verbatim against the transcript before
   * returning it, so hallucinated items never reach the clinician.
   */
  @Post("checklist")
  @ApiOperation({
    summary:
      "Extract the clinician's stated action items from the encounter " +
      "transcript for smart-checklist suggestions (extraction-only, quote-verified).",
  })
  async extractChecklist(
    @Param("id") patientId: string,
    @Body() body: { transcript: string },
    @Req() req: Request,
  ): Promise<{ items: readonly { label: string; supporting_quote: string }[] }> {
    const userId = getRequestingUserId(req);
    await this.scopeService.assertPatientInScope(userId, patientId);

    const result = await this.aiTeamService.extractChecklist(patientId, body.transcript);

    await writeAuditEvent(this.pool, {
      actor_id: userId as import("@clinical-copilot/shared-types").UserId,
      actor_role: null,
      action: "AI_TEAM_CHECKLIST_EXTRACTED",
      target_type: "patient",
      target_id: patientId as import("@clinical-copilot/shared-types").PatientId,
      outcome: "SUCCESS",
      metadata_json: { item_count: result.items.length },
      request_id: (req.headers["x-request-id"] as string | undefined ?? null) as import("@clinical-copilot/shared-types").RequestId | null,
    });

    return result;
  }
}
