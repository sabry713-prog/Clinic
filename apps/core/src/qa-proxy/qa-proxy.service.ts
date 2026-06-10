/**
 * QAProxyService
 *
 * HTTP client calling apps/qa service. Manages persistence to app.qa_interaction
 * and app.qa_conversation tables.
 *
 * Constraints:
 * - No PHI in operational logs (question text goes to qa_interaction only)
 * - Audit every interaction
 */

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  Inject,
} from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import type { QAResponseDto, QAInteractionSummaryDto, AnswerSourceDto } from "./dto/qa-response.dto";

export interface AskOptions {
  patientId: string;
  userId: string;
  question: string;
  language: string;
  conversationId: string | null;
}

const DISCLAIMER =
  "Factual lookup only. Not a clinical interpretation. For clinician review only.";

@Injectable()
export class QAProxyService {
  private readonly logger = new Logger(QAProxyService.name);
  private readonly qaServiceUrl: string;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {
    this.qaServiceUrl = process.env["QA_SERVICE_URL"] ?? "http://localhost:5002";
  }

  async ask(options: AskOptions): Promise<QAResponseDto> {
    const { patientId, userId, question, language, conversationId } = options;

    // Ensure conversation exists
    const resolvedConversationId = await this._ensureConversation(
      patientId,
      userId,
      conversationId,
    );

    // Call QA service
    const startMs = Date.now();
    let serviceResponse: Record<string, unknown>;

    try {
      const res = await fetch(`${this.qaServiceUrl}/qa/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId,
          question,
          language,
          conversation_id: resolvedConversationId,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        this.logger.error("qa_service_error", {
          patientId,
          status: res.status,
          code: (body as { error?: { code?: string } }).error?.code,
        });
        throw new ServiceUnavailableException({
          error: { code: "QA_SERVICE_UNAVAILABLE", message: "QA service returned an error" },
        });
      }

      serviceResponse = (await res.json()) as Record<string, unknown>;
    } catch (err: unknown) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error("qa_service_unreachable", {
        patientId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new ServiceUnavailableException({
        error: { code: "QA_SERVICE_UNAVAILABLE", message: "QA service is unreachable" },
      });
    }

    const latencyMs = Date.now() - startMs;

    // Persist interaction
    const interactionId = await this._persistInteraction(
      serviceResponse,
      patientId,
      userId,
      resolvedConversationId,
      question,
      language,
      latencyMs,
    );

    this.logger.log("qa_interaction_completed", {
      interaction_id: interactionId,
      patient_id: patientId,
      classification: serviceResponse["classification"],
      refusal_category: serviceResponse["refusal_category"],
      latency_ms: latencyMs,
      // Do NOT log question text
    });

    return this._toResponse(serviceResponse, interactionId, patientId, resolvedConversationId);
  }

  async getInteraction(
    patientId: string,
    qaId: string,
  ): Promise<QAResponseDto | null> {
    const result = await this.pool.query<{
      id: string;
      conversation_id: string | null;
      patient_id: string;
      question_text: string;
      question_language: string;
      classification: string;
      classifier_confidence: string;
      refusal_category: string | null;
      rule_matches: string[] | null;
      answer_text: string | null;
      sources_json: unknown;
      model_version: string | null;
      prompt_template_version: string | null;
      latency_ms: number;
      blocklist_retries: number;
      created_at: Date;
    }>(
      `SELECT id, conversation_id, patient_id, question_text, question_language,
              classification, classifier_confidence, refusal_category, rule_matches,
              answer_text, sources_json, model_version, prompt_template_version,
              latency_ms, blocklist_retries, created_at
       FROM app.qa_interaction
       WHERE id = $1 AND patient_id = $2`,
      [qaId, patientId],
    );

    if (result.rows.length === 0) return null;
    const row = result.rows[0]!;

    return {
      interaction_id: row.id,
      patient_id: row.patient_id,
      conversation_id: row.conversation_id ?? "",
      question: row.question_text,
      classification: row.classification as "ALLOWED" | "REFUSED",
      classifier_confidence: parseFloat(row.classifier_confidence),
      refusal_category: row.refusal_category,
      rule_matches: row.rule_matches ?? [],
      language: row.question_language,
      answer_text: row.answer_text ?? "",
      sources: this._parseSources(row.sources_json),
      model_version: row.model_version ?? "",
      prompt_template_version: row.prompt_template_version ?? "",
      latency_ms: row.latency_ms,
      disclaimer: DISCLAIMER,
      blocklist_triggered: row.blocklist_retries > 0,
    };
  }

  async listInteractions(
    patientId: string,
    cursor?: string,
    limit = 20,
  ): Promise<{ data: QAInteractionSummaryDto[]; next_cursor: string | null; total: number | null }> {
    const effectiveLimit = Math.min(limit, 100);

    let rows: Array<{
      id: string;
      conversation_id: string | null;
      patient_id: string;
      classification: string;
      refusal_category: string | null;
      question_language: string;
      created_at: Date;
    }>;

    if (cursor) {
      const res = await this.pool.query<{
        id: string;
        conversation_id: string | null;
        patient_id: string;
        classification: string;
        refusal_category: string | null;
        question_language: string;
        created_at: Date;
      }>(
        `SELECT id, conversation_id, patient_id, classification, refusal_category,
                question_language, created_at
         FROM app.qa_interaction
         WHERE patient_id = $1 AND created_at < (SELECT created_at FROM app.qa_interaction WHERE id = $2)
         ORDER BY created_at DESC
         LIMIT $3`,
        [patientId, cursor, effectiveLimit + 1],
      );
      rows = res.rows;
    } else {
      const res = await this.pool.query<{
        id: string;
        conversation_id: string | null;
        patient_id: string;
        classification: string;
        refusal_category: string | null;
        question_language: string;
        created_at: Date;
      }>(
        `SELECT id, conversation_id, patient_id, classification, refusal_category,
                question_language, created_at
         FROM app.qa_interaction
         WHERE patient_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [patientId, effectiveLimit + 1],
      );
      rows = res.rows;
    }

    const hasMore = rows.length > effectiveLimit;
    const data = rows.slice(0, effectiveLimit).map((row) => ({
      id: row.id,
      conversation_id: row.conversation_id,
      patient_id: row.patient_id,
      classification: row.classification,
      refusal_category: row.refusal_category,
      language: row.question_language,
      created_at: row.created_at.toISOString(),
    }));

    return {
      data,
      next_cursor: hasMore ? data[data.length - 1]!.id : null,
      total: null,
    };
  }

  async softDeleteConversation(conversationId: string, userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE app.qa_conversation SET ended_at = now()
       WHERE id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async _ensureConversation(
    patientId: string,
    userId: string,
    conversationId: string | null,
  ): Promise<string> {
    if (conversationId) {
      // Verify it belongs to this user+patient
      const res = await this.pool.query<{ id: string }>(
        `SELECT id FROM app.qa_conversation
         WHERE id = $1 AND user_id = $2 AND patient_id = $3 AND ended_at IS NULL`,
        [conversationId, userId, patientId],
      );
      if (res.rows.length > 0) return conversationId;
    }

    // Create new conversation
    const res = await this.pool.query<{ id: string }>(
      `INSERT INTO app.qa_conversation (user_id, patient_id) VALUES ($1, $2) RETURNING id`,
      [userId, patientId],
    );
    return res.rows[0]!.id;
  }

  private async _persistInteraction(
    data: Record<string, unknown>,
    patientId: string,
    userId: string,
    conversationId: string,
    questionText: string,
    language: string,
    latencyMs: number,
  ): Promise<string> {
    const classification = String(data["classification"] ?? "REFUSED");
    const confidence = Number(data["classifier_confidence"] ?? 0);
    const refusalCategory = data["refusal_category"]
      ? String(data["refusal_category"])
      : null;
    const ruleMatches = Array.isArray(data["rule_matches"])
      ? (data["rule_matches"] as string[])
      : [];
    const answerText = typeof data["answer_text"] === "string" ? data["answer_text"] : null;
    const sources = data["sources"] ?? [];
    const modelVersion = typeof data["model_version"] === "string" ? data["model_version"] : null;
    const promptVersion =
      typeof data["prompt_template_version"] === "string"
        ? data["prompt_template_version"]
        : "v1.0";
    const blocklistRetries = typeof data["blocklist_triggered"] === "boolean"
      ? (data["blocklist_triggered"] ? 1 : 0)
      : 0;

    const res = await this.pool.query<{ id: string }>(
      `INSERT INTO app.qa_interaction
         (conversation_id, user_id, patient_id, question_text, question_language,
          classification, classifier_confidence, refusal_category, rule_matches,
          answer_text, sources_json, model_version, prompt_template_version,
          latency_ms, blocklist_retries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      [
        conversationId,
        userId,
        patientId,
        questionText,
        language,
        classification,
        confidence,
        refusalCategory,
        ruleMatches,
        answerText,
        JSON.stringify(sources),
        modelVersion,
        promptVersion,
        latencyMs,
        blocklistRetries,
      ],
    );

    return res.rows[0]!.id;
  }

  private _toResponse(
    data: Record<string, unknown>,
    interactionId: string,
    patientId: string,
    conversationId: string,
  ): QAResponseDto {
    return {
      interaction_id: interactionId,
      patient_id: patientId,
      conversation_id: conversationId,
      question: typeof data["question"] === "string" ? data["question"] : "",
      classification: (data["classification"] as "ALLOWED" | "REFUSED") ?? "REFUSED",
      classifier_confidence: Number(data["classifier_confidence"] ?? 0),
      refusal_category:
        typeof data["refusal_category"] === "string" ? data["refusal_category"] : null,
      rule_matches: Array.isArray(data["rule_matches"])
        ? (data["rule_matches"] as string[])
        : [],
      language: typeof data["language"] === "string" ? data["language"] : "en",
      answer_text: typeof data["answer_text"] === "string" ? data["answer_text"] : "",
      sources: this._parseSources(data["sources"]),
      model_version: typeof data["model_version"] === "string" ? data["model_version"] : "",
      prompt_template_version:
        typeof data["prompt_template_version"] === "string"
          ? data["prompt_template_version"]
          : "v1.0",
      latency_ms: typeof data["latency_ms"] === "number" ? data["latency_ms"] : 0,
      disclaimer: DISCLAIMER,
      blocklist_triggered:
        typeof data["blocklist_triggered"] === "boolean" ? data["blocklist_triggered"] : false,
    };
  }

  private _parseSources(raw: unknown): AnswerSourceDto[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((s: unknown) => {
      const src = s as Record<string, unknown>;
      return {
        fact_segment: String(src["fact_segment"] ?? ""),
        type: String(src["type"] ?? ""),
        id: String(src["id"] ?? ""),
        code: String(src["code"] ?? ""),
        source_system: String(src["source_system"] ?? ""),
        field: String(src["field"] ?? ""),
      };
    });
  }
}
