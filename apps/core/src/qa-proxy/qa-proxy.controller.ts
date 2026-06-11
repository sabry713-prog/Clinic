/**
 * QAProxyController
 *
 * Routes for factual Q&A. The classifier runs inside apps/qa; this controller
 * handles scope enforcement, rate limiting, audit events, and persistence.
 *
 * Constraints:
 * - REFUSED path writes QA_REFUSED audit event; no PHI in event metadata
 * - ALLOWED path writes QA_ANSWERED audit event
 * - Question text is stored in app.qa_interaction only, not in operational logs
 */

import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Inject,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { QAProxyService } from "./qa-proxy.service";
import { PatientScopeService } from "../patient/patient-scope.service";
import { writeAuditEvent } from "@clinical-copilot/audit";
import { AskQuestionDto } from "./dto/ask-question.dto";
import type { QAResponseDto, QAInteractionListDto } from "./dto/qa-response.dto";

// In-memory sliding-window rate limiter (30 req/min per user per endpoint)
// Replace with Redis in production (Slice 5).
const rateLimitWindows = new Map<string, number[]>();
const QA_RATE_LIMIT = 30;
const QA_RATE_WINDOW_MS = 60_000;

function checkRateLimit(userId: string): boolean {
  const key = `qa:${userId}`;
  const now = Date.now();
  const window = (rateLimitWindows.get(key) ?? []).filter(
    (ts) => now - ts < QA_RATE_WINDOW_MS,
  );
  if (window.length >= QA_RATE_LIMIT) return false;
  window.push(now);
  rateLimitWindows.set(key, window);
  return true;
}

@ApiTags("qa")
@Controller("api/v1/patients/:patientId/qa")
export class QAProxyController {
  constructor(
    private readonly qaSvc: QAProxyService,
    private readonly scopeSvc: PatientScopeService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  // ── POST /api/v1/patients/:patientId/qa ───────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Ask a factual question about a patient" })
  async ask(
    @Param("patientId") patientId: string,
    @Body() body: AskQuestionDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const userId = req.authenticatedUserId ?? "";
    const userRole = req.authenticatedUserRole ?? "physician";
    const requestId = req.requestId ?? "";

    // 1. Scope check
    await this.scopeSvc.assertPatientInScope(userId, patientId);

    // 2. Rate limit (30 questions / min)
    if (!checkRateLimit(userId)) {
      res.setHeader("X-RateLimit-Limit", String(QA_RATE_LIMIT));
      res.setHeader("X-RateLimit-Remaining", "0");
      res.status(429).json({ error: { code: "RATE_LIMITED", message: "Q&A rate limit exceeded (30/min)", trace_id: requestId } });
      return;
    }

    const language = body.language ?? "en";
    const conversationId = body.conversation_id ?? null;

    // 3. Call QA service + persist
    const response: QAResponseDto = await this.qaSvc.ask({
      patientId,
      userId,
      question: body.question,
      language,
      conversationId,
    });

    // 4. Audit event -- no PHI; classification + category only
    const auditEventId = await writeAuditEvent(this.pool, {
      actor_id: userId as unknown as import("@clinical-copilot/shared-types").UserId,
      actor_role: userRole as unknown as import("@clinical-copilot/shared-types").UserRole | null,
      action: response.classification === "ALLOWED" ? "QA_ANSWERED" : "QA_REFUSED",
      target_type: "PATIENT",
      target_id: patientId,
      outcome: "SUCCESS",
      request_id: requestId as unknown as import("@clinical-copilot/shared-types").RequestId,
      metadata_json: {
        classification: response.classification,
        refusal_category: response.refusal_category,
        interaction_id: response.interaction_id,
        // Do NOT include question text or answer text here
      },
    });

    res.setHeader("X-Audit-Event-Id", auditEventId.id);
    res.setHeader("X-Trace-Id", requestId);
    res.status(HttpStatus.OK).json(response);
  }

  // ── GET /api/v1/patients/:patientId/qa/:qaId ──────────────────────────────

  @Get(":qaId")
  @ApiOperation({ summary: "Retrieve a Q&A interaction" })
  async getInteraction(
    @Param("patientId") patientId: string,
    @Param("qaId") qaId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const userId = req.authenticatedUserId ?? "";
    await this.scopeSvc.assertPatientInScope(userId, patientId);

    const interaction = await this.qaSvc.getInteraction(patientId, qaId);
    if (!interaction) {
      throw new NotFoundException({ error: { code: "NOT_FOUND", message: "Interaction not found" } });
    }

    res.setHeader("X-Trace-Id", req.requestId ?? "");
    res.status(HttpStatus.OK).json(interaction);
  }

  // ── GET /api/v1/patients/:patientId/qa ────────────────────────────────────

  @Get()
  @ApiOperation({ summary: "List Q&A interactions for a patient" })
  async listInteractions(
    @Param("patientId") patientId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Req() req?: Request,
    @Res() res?: Response,
  ): Promise<void> {
    const userId = req?.authenticatedUserId ?? "";
    await this.scopeSvc.assertPatientInScope(userId, patientId);

    const result: QAInteractionListDto = await this.qaSvc.listInteractions(
      patientId,
      cursor,
      limit ? Math.min(parseInt(limit, 10), 100) : 20,
    );

    res?.setHeader("X-Trace-Id", req?.requestId ?? "");
    res?.status(HttpStatus.OK).json(result);
  }
}

// ── DELETE /api/v1/conversations/:conversationId ─────────────────────────────

@ApiTags("qa")
@Controller("api/v1/conversations")
export class ConversationController {
  constructor(
    private readonly qaSvc: QAProxyService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Delete(":conversationId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "End (soft-delete) a conversation" })
  async deleteConversation(
    @Param("conversationId") conversationId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const userId = req.authenticatedUserId ?? "";
    await this.qaSvc.softDeleteConversation(conversationId, userId);

    await writeAuditEvent(this.pool, {
      actor_id: userId as unknown as import("@clinical-copilot/shared-types").UserId,
      actor_role: (req.authenticatedUserRole ?? "physician") as unknown as import("@clinical-copilot/shared-types").UserRole | null,
      action: "QA_CONVERSATION_ENDED",
      target_type: "QA_CONVERSATION",
      target_id: conversationId,
      outcome: "SUCCESS",
      request_id: (req.requestId as unknown as import("@clinical-copilot/shared-types").RequestId) ?? null,
      metadata_json: {},
    });

    res.status(HttpStatus.NO_CONTENT).send();
  }
}
