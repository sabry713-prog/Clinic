/**
 * NarrativeProxyService
 *
 * Calls the Python narrative gRPC service via HTTP (in Slice 2 we use HTTP
 * for simplicity; gRPC transport can be swapped in when grpc-js is added).
 * The service also manages the narrative_output cache in PostgreSQL.
 *
 * Constraints:
 * - No PHI in logs
 * - Narrative text goes to audit log only, never to operational logs
 */

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  Inject,
} from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { PG_POOL } from "../database/database.module";

export interface GenerateNarrativeOptions {
  patientId: string;
  userId: string;
  language: string;
  scope: string;
  forceRegenerate: boolean;
}

export interface SourceRef {
  readonly type: string;
  readonly id: string;
  readonly field: string;
}

export interface ProvenanceEntry {
  readonly sentence_index: number;
  readonly char_range: readonly [number, number];
  readonly sources: readonly SourceRef[];
}

export interface NarrativeResponse {
  readonly id: string;
  readonly patient_id: string;
  readonly generated_at: string;
  readonly language: string;
  readonly scope: string;
  readonly text: string | null;
  readonly fallback_message: string | null;
  readonly provenance: readonly ProvenanceEntry[];
  readonly model_version: string | null;
  readonly prompt_template_version: string;
  readonly disclaimer: string;
}

const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes
const DISCLAIMER =
  "Auto-generated descriptive summary. Not a clinical interpretation. For clinician review only.";

@Injectable()
export class NarrativeProxyService {
  private readonly logger = new Logger(NarrativeProxyService.name);
  private readonly narrativeServiceUrl: string;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {
    this.narrativeServiceUrl =
      process.env["NARRATIVE_SERVICE_URL"] ?? "http://localhost:5001";
  }

  async generate(options: GenerateNarrativeOptions): Promise<NarrativeResponse> {
    const { patientId, userId, language, scope, forceRegenerate } = options;

    // Check cache (< 5 min old, same language and scope)
    if (!forceRegenerate) {
      const cached = await this._getCached(patientId, language, scope);
      if (cached !== null) {
        this.logger.log("narrative_cache_hit", { patientId, language, scope });
        return cached;
      }
    }

    // Call narrative service
    const startMs = Date.now();
    let serviceResponse: Record<string, unknown>;
    try {
      const res = await fetch(`${this.narrativeServiceUrl}/narrative/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId,
          language,
          scope,
          force_regenerate: forceRegenerate,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        this.logger.error("narrative_service_error", {
          patientId,
          status: res.status,
          code: (body as { error?: { code?: string } }).error?.code,
        });
        throw new ServiceUnavailableException({
          error: {
            code: "NARRATIVE_SERVICE_UNAVAILABLE",
            message: "Narrative service returned an error",
          },
        });
      }

      serviceResponse = (await res.json()) as Record<string, unknown>;
    } catch (err: unknown) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error("narrative_service_unreachable", {
        patientId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new ServiceUnavailableException({
        error: {
          code: "NARRATIVE_SERVICE_UNAVAILABLE",
          message: "Narrative service is unreachable",
        },
      });
    }

    const latencyMs = Date.now() - startMs;

    // Persist to app.narrative_output
    const narrativeId = await this._persistNarrative(
      serviceResponse,
      patientId,
      userId,
      language,
      scope,
    );

    // Log audit event (narrative text not in operational log)
    this.logger.log("narrative_generated", {
      narrative_id: narrativeId,
      patient_id: patientId,
      language,
      scope,
      latency_ms: latencyMs,
      blocklist_triggered: serviceResponse["blocklist_triggered"] ?? false,
    });

    return this._toResponse(serviceResponse, narrativeId, patientId);
  }

  async getById(
    patientId: string,
    narrativeId: string,
  ): Promise<NarrativeResponse | null> {
    const result = await this.pool.query<{
      id: string;
      patient_id: string;
      scope: string;
      language: string;
      text: string | null;
      fallback: boolean;
      provenance_json: unknown;
      model_version: string | null;
      prompt_template_version: string;
      created_at: Date;
    }>(
      `SELECT id, patient_id, scope, language, text, fallback,
              provenance_json, model_version, prompt_template_version, created_at
       FROM app.narrative_output
       WHERE id = $1 AND patient_id = $2`,
      [narrativeId, patientId],
    );

    if (result.rows.length === 0) return null;
    const row = result.rows[0]!;

    return {
      id: row.id,
      patient_id: row.patient_id,
      generated_at: row.created_at.toISOString(),
      language: row.language,
      scope: row.scope,
      text: row.text,
      fallback_message: row.fallback
        ? "Narrative summary unavailable. Please review the record directly."
        : null,
      provenance: this._parseProvenance(row.provenance_json),
      model_version: row.model_version,
      prompt_template_version: row.prompt_template_version,
      disclaimer: DISCLAIMER,
    };
  }

  async getSources(
    patientId: string,
    narrativeId: string,
  ): Promise<readonly SourceRef[]> {
    const narrative = await this.getById(patientId, narrativeId);
    if (!narrative) return [];

    const allSources = narrative.provenance.flatMap((p) => [...p.sources]);
    // Deduplicate
    const seen = new Set<string>();
    return allSources.filter((s) => {
      const key = `${s.type}:${s.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async _getCached(
    patientId: string,
    language: string,
    scope: string,
  ): Promise<NarrativeResponse | null> {
    const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();
    const result = await this.pool.query<{
      id: string;
      patient_id: string;
      scope: string;
      language: string;
      text: string | null;
      fallback: boolean;
      provenance_json: unknown;
      model_version: string | null;
      prompt_template_version: string;
      created_at: Date;
    }>(
      `SELECT id, patient_id, scope, language, text, fallback,
              provenance_json, model_version, prompt_template_version, created_at
       FROM app.narrative_output
       WHERE patient_id = $1
         AND language = $2
         AND scope = $3
         AND created_at >= $4
       ORDER BY created_at DESC
       LIMIT 1`,
      [patientId, language, scope, cutoff],
    );

    if (result.rows.length === 0) return null;
    const row = result.rows[0]!;
    return {
      id: row.id,
      patient_id: row.patient_id,
      generated_at: row.created_at.toISOString(),
      language: row.language,
      scope: row.scope,
      text: row.text,
      fallback_message: row.fallback
        ? "Narrative summary unavailable. Please review the record directly."
        : null,
      provenance: this._parseProvenance(row.provenance_json),
      model_version: row.model_version,
      prompt_template_version: row.prompt_template_version,
      disclaimer: DISCLAIMER,
    };
  }

  private async _persistNarrative(
    data: Record<string, unknown>,
    patientId: string,
    userId: string,
    language: string,
    scope: string,
  ): Promise<string> {
    const text = typeof data["text"] === "string" ? data["text"] : null;
    const fallback = !text;
    const provenance = data["provenance"] ?? [];
    const modelVersion =
      typeof data["model_version"] === "string" ? data["model_version"] : null;
    const promptVersion =
      typeof data["prompt_template_version"] === "string"
        ? data["prompt_template_version"]
        : "v1.0";
    const blocklistRetries =
      typeof data["blocklist_retries"] === "number" ? data["blocklist_retries"] : 0;

    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO app.narrative_output
         (patient_id, generated_by_user_id, scope, language, text, fallback,
          provenance_json, model_version, prompt_template_version, blocklist_retries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        patientId,
        userId,
        scope,
        language,
        text,
        fallback,
        JSON.stringify(provenance),
        modelVersion,
        promptVersion,
        blocklistRetries,
      ],
    );

    return result.rows[0]!.id;
  }

  private _toResponse(
    data: Record<string, unknown>,
    narrativeId: string,
    patientId: string,
  ): NarrativeResponse {
    return {
      id: narrativeId,
      patient_id: patientId,
      generated_at: new Date().toISOString(),
      language: typeof data["language"] === "string" ? data["language"] : "en",
      scope: typeof data["scope"] === "string" ? data["scope"] : "full",
      text: typeof data["text"] === "string" && data["text"] ? data["text"] : null,
      fallback_message:
        typeof data["fallback_message"] === "string" && data["fallback_message"]
          ? data["fallback_message"]
          : null,
      provenance: this._parseProvenance(data["provenance"]),
      model_version:
        typeof data["model_version"] === "string" ? data["model_version"] : null,
      prompt_template_version:
        typeof data["prompt_template_version"] === "string"
          ? data["prompt_template_version"]
          : "v1.0",
      disclaimer: DISCLAIMER,
    };
  }

  private _parseProvenance(raw: unknown): readonly ProvenanceEntry[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((entry: unknown) => {
      const e = entry as Record<string, unknown>;
      const sources = Array.isArray(e["sources"])
        ? (e["sources"] as Array<Record<string, unknown>>).map((s) => ({
            type: String(s["type"] ?? ""),
            id: String(s["id"] ?? ""),
            field: String(s["field"] ?? ""),
          }))
        : [];
      const charStart =
        typeof e["char_start"] === "number" ? e["char_start"] : 0;
      const charEnd = typeof e["char_end"] === "number" ? e["char_end"] : 0;
      return {
        sentence_index:
          typeof e["sentence_index"] === "number" ? e["sentence_index"] : 0,
        char_range: [charStart, charEnd] as const,
        sources,
      };
    });
  }
}
