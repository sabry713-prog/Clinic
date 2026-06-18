import { Injectable, Logger, Inject, NotFoundException } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { PatientScopeService } from "./patient-scope.service";
import type { PatientListQueryDto } from "./dto/patient-list-query.dto";
import type { ObservationsQueryDto } from "./dto/observations-query.dto";
import type { MedicationsQueryDto } from "./dto/medications-query.dto";

// ─── Response types ───────────────────────────────────────────────────────────

export interface PatientSummary {
  readonly id: string;
  readonly mrn: string | null;
  readonly display_name: string | null;
  readonly date_of_birth: string | null;
  readonly sex: string | null;
  readonly preferred_language: string | null;
  readonly ward: string | null;
}

export interface AllergyItem {
  readonly id: string;
  readonly code: string | null;
  readonly code_display: string | null;
  readonly reaction: string | null;
  readonly recorded_at: string | null;
}

export interface ConditionItem {
  readonly id: string;
  readonly code: string | null;
  readonly code_display: string | null;
  readonly status: string | null;
  readonly onset_date: string | null;
}

export interface PatientDetail extends PatientSummary {
  readonly allergies: readonly AllergyItem[];
  readonly conditions: readonly ConditionItem[];
}

export interface ObservationItem {
  readonly id: string;
  readonly category: string | null;
  readonly code: string | null;
  readonly code_display: string | null;
  readonly value_numeric: number | null;
  readonly value_text: string | null;
  readonly unit: string | null;
  readonly ref_range_low: number | null;
  readonly ref_range_high: number | null;
  readonly ref_range_text: string | null;
  readonly effective_at: string | null;
}

export interface MedicationItem {
  readonly id: string;
  readonly medication_display: string | null;
  readonly code: string | null;
  readonly dose: string | null;
  readonly route: string | null;
  readonly frequency: string | null;
  readonly status: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
}

// ─── Medication reconciliation (E1) ──────────────────────────────────────────
// Factual, descriptive only. No severity, no flags, no ordering by importance,
// no "conflict requiring action" language. Differences are stated as documented
// facts with provenance. Non-SaMD (CLAUDE.md §2).

export interface ReconciliationEntry {
  readonly source: string;
  readonly source_id: string;
  readonly dose: string | null;
  readonly route: string | null;
  readonly frequency: string | null;
  readonly status: string | null;
  readonly started_at: string | null;
}

export interface ReconciliationMedication {
  readonly code: string | null;
  readonly medication_display: string | null;
  readonly documented_in: readonly string[];      // sources that document this medication
  readonly absent_from: readonly string[];         // sources that do NOT document it
  readonly entries: readonly ReconciliationEntry[]; // one per documenting source
  // Plain factual difference statements (no severity, no recommendation):
  //  "Documented in ehr; not documented in pharmacy."
  //  "Documented dose strings differ: '5 mg' (ehr, 12 May) vs '10 mg' (pharmacy, 14 May)."
  readonly differences: readonly string[];
}

export interface ReconciliationSourceList {
  readonly source: string;
  readonly medications: readonly MedicationItem[];
}

export interface MedicationReconciliation {
  readonly patient_id: string;
  readonly sources: readonly string[];
  readonly per_source: readonly ReconciliationSourceList[];
  readonly reconciliation: readonly ReconciliationMedication[];
  readonly generated_at: string;
}

// ─── Record search (E2) ──────────────────────────────────────────────────────
// Verbatim record excerpts only — no synthesis, no generation, no blocklist
// exposure (the safest feature shape). Newest-first per group.

export interface SearchResultItem {
  readonly source_type: string;
  readonly source_id: string;
  readonly excerpt: string;          // verbatim record text
  readonly language: string;
  readonly recorded_at: string | null;
}

export interface SearchResultGroup {
  readonly source_type: string;
  readonly results: readonly SearchResultItem[];
}

export interface RecordSearchResponse {
  readonly patient_id: string;
  readonly query: string;
  readonly total: number;
  readonly groups: readonly SearchResultGroup[];
}

export interface DocumentItem {
  readonly id: string;
  readonly type: string | null;
  readonly authored_at: string | null;
  readonly author_display: string | null;
  readonly content_text: string | null;
}

export interface EncounterItem {
  readonly id: string;
  readonly encounter_type: string | null;
  readonly status: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly ward: string | null;
}

export interface ConditionEpisode {
  readonly id: string;
  readonly status: string | null;
  readonly onset_date: string | null;
  readonly encounter: {
    readonly id: string;
    readonly ward: string | null;
    readonly started_at: string | null;
  } | null;
  readonly note: {
    readonly id: string;
    readonly type: string | null;
    readonly authored_at: string | null;
    readonly author_display: string | null;
    readonly content_text: string | null;
  } | null;
}

export interface ConditionHistory {
  readonly code: {
    readonly system: string | null;
    readonly code: string | null;
    readonly display: string | null;
  };
  readonly episodes: readonly ConditionEpisode[];
}

export interface CursorPage<T> {
  readonly data: readonly T[];
  readonly next_cursor: string | null;
  readonly total: number | null;
}

const DEFAULT_LIMIT = 20;

@Injectable()
export class PatientService {
  private readonly logger = new Logger(PatientService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly scopeService: PatientScopeService,
  ) {}

  // ─── Patient list ─────────────────────────────────────────────────────────

  async listPatients(
    userId: string,
    query: PatientListQueryDto,
  ): Promise<CursorPage<PatientSummary>> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const scopedIds = await this.scopeService.getScopedPatientIds(userId);
    const scopeArray = Array.from(scopedIds);

    if (scopeArray.length === 0) {
      return { data: [], next_cursor: null, total: 0 };
    }

    const params: unknown[] = [scopeArray];
    let filterClause = `WHERE p.id = ANY($1)`;

    if (query.q) {
      params.push(`%${query.q.toLowerCase()}%`);
      filterClause += ` AND (lower(p.display_name) LIKE $${params.length} OR p.mrn LIKE $${params.length})`;
    }

    if (query.ward) {
      params.push(query.ward);
      filterClause += ` AND e.ward = $${params.length}`;
    }

    if (query.cursor) {
      // cursor is base64-encoded "id"
      const cursorId = Buffer.from(query.cursor, "base64url").toString("utf8");
      params.push(cursorId);
      filterClause += ` AND p.id > $${params.length}`;
    }

    params.push(limit + 1);
    const limitParam = params.length;

    const sql = `
      SELECT DISTINCT ON (p.id)
        p.id,
        p.mrn,
        p.display_name,
        p.date_of_birth::text as date_of_birth,
        p.sex,
        p.preferred_language,
        e.ward
      FROM hospital.patient p
      LEFT JOIN hospital.encounter e ON e.patient_id = p.id AND e.status = 'in-progress'
      ${filterClause}
      ORDER BY p.id
      LIMIT $${limitParam}
    `;

    const result = await this.pool.query<PatientSummary & { ward: string | null }>(sql, params);
    const rows = result.rows;

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const next_cursor = hasMore
      ? Buffer.from(data[data.length - 1]!.id, "utf8").toString("base64url")
      : null;

    return { data, next_cursor, total: null };
  }

  // ─── Patient detail ───────────────────────────────────────────────────────

  async getPatient(userId: string, patientId: string): Promise<PatientDetail> {
    await this.scopeService.assertPatientInScope(userId, patientId);

    const patientResult = await this.pool.query<PatientSummary>(
      `SELECT p.id, p.mrn, p.display_name,
              p.date_of_birth::text as date_of_birth, p.sex, p.preferred_language,
              e.ward
       FROM hospital.patient p
       LEFT JOIN hospital.encounter e ON e.patient_id = p.id AND e.status = 'in-progress'
       WHERE p.id = $1
       ORDER BY e.started_at DESC NULLS LAST
       LIMIT 1`,
      [patientId],
    );

    const patient = patientResult.rows[0];
    if (!patient) throw new NotFoundException("Patient not found");

    const [allergiesResult, conditionsResult] = await Promise.all([
      this.pool.query<AllergyItem>(
        `SELECT id, code, code_display, reaction, recorded_at::text as recorded_at
         FROM hospital.allergy_intolerance
         WHERE patient_id = $1
         ORDER BY recorded_at DESC NULLS LAST`,
        [patientId],
      ),
      this.pool.query<ConditionItem>(
        `SELECT id, code, code_display, status, onset_date::text as onset_date
         FROM hospital.condition
         WHERE patient_id = $1
         ORDER BY onset_date DESC NULLS LAST`,
        [patientId],
      ),
    ]);

    return {
      ...patient,
      allergies: allergiesResult.rows,
      conditions: conditionsResult.rows,
    };
  }

  // ─── Observations ─────────────────────────────────────────────────────────

  async listObservations(
    userId: string,
    patientId: string,
    query: ObservationsQueryDto,
  ): Promise<CursorPage<ObservationItem>> {
    await this.scopeService.assertPatientInScope(userId, patientId);

    const limit = query.limit ?? DEFAULT_LIMIT;
    const params: unknown[] = [patientId];
    let whereClause = "WHERE patient_id = $1";

    if (query.code) {
      params.push(query.code);
      whereClause += ` AND code = $${params.length}`;
    }

    if (query.category) {
      params.push(query.category);
      whereClause += ` AND category = $${params.length}`;
    }

    if (query.since) {
      params.push(query.since);
      whereClause += ` AND effective_at >= $${params.length}`;
    }

    if (query.until) {
      params.push(query.until);
      whereClause += ` AND effective_at <= $${params.length}`;
    }

    if (query.cursor) {
      const cursorTs = Buffer.from(query.cursor, "base64url").toString("utf8");
      params.push(cursorTs);
      whereClause += ` AND effective_at < $${params.length}`;
    }

    params.push(limit + 1);

    const result = await this.pool.query<ObservationItem>(
      `SELECT id, category, code, code_display,
              value_numeric, value_text, unit,
              ref_range_low, ref_range_high, ref_range_text,
              effective_at::text as effective_at
       FROM hospital.observation
       ${whereClause}
       ORDER BY effective_at DESC NULLS LAST
       LIMIT $${params.length}`,
      params,
    );

    const rows = result.rows;
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const next_cursor = hasMore && data[data.length - 1]?.effective_at
      ? Buffer.from(data[data.length - 1]!.effective_at!, "utf8").toString("base64url")
      : null;

    return { data, next_cursor, total: null };
  }

  // ─── Medications ──────────────────────────────────────────────────────────

  async listMedications(
    userId: string,
    patientId: string,
    query: MedicationsQueryDto,
  ): Promise<CursorPage<MedicationItem>> {
    await this.scopeService.assertPatientInScope(userId, patientId);

    const params: unknown[] = [patientId];
    let whereClause = "WHERE patient_id = $1";

    if (query.status) {
      params.push(query.status);
      whereClause += ` AND status = $${params.length}`;
    }

    if (query.cursor) {
      const cursorId = Buffer.from(query.cursor, "base64url").toString("utf8");
      params.push(cursorId);
      whereClause += ` AND id > $${params.length}`;
    }

    params.push(DEFAULT_LIMIT + 1);

    const result = await this.pool.query<MedicationItem>(
      `SELECT id, medication_display, code, dose, route, frequency,
              status, started_at::text as started_at, ended_at::text as ended_at
       FROM hospital.medication_request
       ${whereClause}
       ORDER BY started_at DESC NULLS LAST, id
       LIMIT $${params.length}`,
      params,
    );

    const rows = result.rows;
    const hasMore = rows.length > DEFAULT_LIMIT;
    const data = hasMore ? rows.slice(0, DEFAULT_LIMIT) : rows;
    const next_cursor = hasMore
      ? Buffer.from(data[data.length - 1]!.id, "utf8").toString("base64url")
      : null;

    return { data, next_cursor, total: null };
  }

  // ─── Medication reconciliation (E1) ─────────────────────────────────────────

  async reconcileMedications(
    userId: string,
    patientId: string,
  ): Promise<MedicationReconciliation> {
    await this.scopeService.assertPatientInScope(userId, patientId);

    // Active medications across all source feeds (source_system = the feed).
    const result = await this.pool.query<MedicationItem & { source: string; source_id: string }>(
      `SELECT id, source_system AS source, source_id, medication_display, code,
              dose, route, frequency, status, started_at::text AS started_at,
              ended_at::text AS ended_at
         FROM hospital.medication_request
        WHERE patient_id = $1 AND status = 'active'
        ORDER BY source_system ASC, medication_display ASC`,
      [patientId],
    );
    const rows = result.rows;

    const sources = [...new Set(rows.map((r) => r.source))].sort();

    // Per-source documented lists (each source's own list, alphabetical).
    const per_source: ReconciliationSourceList[] = sources.map((source) => ({
      source,
      medications: rows
        .filter((r) => r.source === source)
        .map(({ source: _s, source_id: _sid, ...med }) => med),
    }));

    // Merge by code when present, else by normalized display name.
    const keyOf = (r: { code: string | null; medication_display: string | null }): string =>
      (r.code && r.code.trim()) || (r.medication_display ?? "").trim().toLowerCase();

    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = keyOf(r);
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
    }

    const reconciliation: ReconciliationMedication[] = [];
    for (const group of groups.values()) {
      const documented_in = [...new Set(group.map((g) => g.source))].sort();
      const absent_from = sources.filter((s) => !documented_in.includes(s));
      const entries: ReconciliationEntry[] = group.map((g) => ({
        source: g.source,
        source_id: g.source_id,
        dose: g.dose,
        route: g.route,
        frequency: g.frequency,
        status: g.status,
        started_at: g.started_at,
      }));

      const differences: string[] = [];

      // Presence difference — stated factually, no severity.
      if (absent_from.length > 0 && sources.length > 1) {
        differences.push(
          `Documented in ${documented_in.join(", ")}; not documented in ${absent_from.join(", ")}.`,
        );
      }

      // Attribute differences (dose/route/frequency) — restate values verbatim.
      for (const field of ["dose", "route", "frequency"] as const) {
        const distinct = [...new Set(entries.map((e) => (e[field] ?? "").trim()).filter(Boolean))];
        if (distinct.length > 1) {
          const parts = entries
            .filter((e) => (e[field] ?? "").trim())
            .map((e) => `'${e[field]}' (${e.source}, ${this.shortDate(e.started_at)})`);
          differences.push(`Documented ${field} strings differ: ${parts.join(" vs ")}.`);
        }
      }

      reconciliation.push({
        code: group[0]!.code,
        medication_display: group[0]!.medication_display,
        documented_in,
        absent_from,
        entries,
        differences,
      });
    }

    // Alphabetical only — never ordered by importance/severity.
    reconciliation.sort((a, b) =>
      (a.medication_display ?? "").localeCompare(b.medication_display ?? ""),
    );

    return {
      patient_id: patientId,
      sources,
      per_source,
      reconciliation,
      generated_at: new Date().toISOString(),
    };
  }

  async searchRecord(
    userId: string,
    patientId: string,
    query: string,
  ): Promise<RecordSearchResponse> {
    await this.scopeService.assertPatientInScope(userId, patientId);

    const q = query.trim();
    if (!q) {
      return { patient_id: patientId, query: q, total: 0, groups: [] };
    }

    // Cross-lingual: records are stored in source form (often English), so map
    // common Arabic clinical terms to their English equivalents and match both.
    // This is the search counterpart to the Q&A aliasing; E3 formalizes Arabic.
    const ilikeTerms = [q, ...PatientService.crossLingualTerms(q)].map((t) => `%${t}%`);

    // Postgres full-text ('simple' config) on the original query, OR an ILIKE
    // over the query + cross-lingual aliases. Verbatim excerpts, newest first.
    const result = await this.pool.query<{
      source_type: string;
      source_id: string;
      content_text: string;
      language: string;
      recorded_at: string | null;
    }>(
      `SELECT source_type, source_id::text AS source_id, content_text,
              language, updated_at::text AS recorded_at
         FROM hospital.retrieval_chunk
        WHERE patient_id = $1
          AND ( to_tsvector('simple', content_text) @@ plainto_tsquery('simple', $2)
                OR content_text ILIKE ANY($3::text[]) )
        ORDER BY source_type ASC, updated_at DESC
        LIMIT 200`,
      [patientId, q, ilikeTerms],
    );

    const groupMap = new Map<string, SearchResultItem[]>();
    for (const r of result.rows) {
      const item: SearchResultItem = {
        source_type: r.source_type,
        source_id: r.source_id,
        excerpt: r.content_text,
        language: r.language,
        recorded_at: r.recorded_at,
      };
      (groupMap.get(r.source_type) ?? groupMap.set(r.source_type, []).get(r.source_type)!).push(item);
    }

    const groups: SearchResultGroup[] = [...groupMap.entries()]
      .map(([source_type, results]) => ({ source_type, results }))
      .sort((a, b) => a.source_type.localeCompare(b.source_type));

    return { patient_id: patientId, query: q, total: result.rows.length, groups };
  }

  // Common Arabic clinical terms → English (records are stored in source form).
  private static readonly AR_EN_TERMS: Readonly<Record<string, string>> = {
    دوخة: "dizziness", دوار: "dizziness", صداع: "headache", سعال: "cough",
    كحة: "cough", غثيان: "nausea", تعب: "fatigue", إرهاق: "fatigue",
    ألم: "pain", الم: "pain", وجع: "pain", صدر: "chest", بطن: "abdominal",
    ظهر: "back", مفاصل: "joint", حلق: "throat", خفقان: "palpitations",
    تنميل: "numbness", حمى: "fever", حرارة: "temperature", ضغط: "pressure",
    سكر: "glucose", جلوكوز: "glucose", كرياتينين: "creatinine",
    هيموجلوبين: "hemoglobin", صوديوم: "sodium", بوتاسيوم: "potassium",
    دواء: "medication", أدوية: "medication", ادوية: "medication",
    حساسية: "allergy", حساسيه: "allergy", تحاليل: "laboratory",
    تحليل: "laboratory", ميتفورمين: "metformin", وارفارين: "warfarin",
  };

  private static crossLingualTerms(query: string): string[] {
    const out: string[] = [];
    for (const tok of query.split(/\s+/)) {
      const t = tok.replace(/[؟?,.،]/g, "");
      const alias = PatientService.AR_EN_TERMS[t] ?? (t.startsWith("ال") ? PatientService.AR_EN_TERMS[t.slice(2)] : undefined);
      if (alias) out.push(alias);
    }
    return out;
  }

  private shortDate(ts: string | null): string {
    if (!ts) return "date unknown";
    const d = new Date(ts);
    return Number.isNaN(d.getTime())
      ? "date unknown"
      : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  // ─── Condition history ────────────────────────────────────────────────────

  async getConditionHistory(
    userId: string,
    patientId: string,
    conditionId: string,
  ): Promise<ConditionHistory> {
    await this.scopeService.assertPatientInScope(userId, patientId);

    const baseResult = await this.pool.query<{
      code_system: string | null;
      code: string | null;
      code_display: string | null;
    }>(
      `SELECT code_system, code, code_display
       FROM hospital.condition
       WHERE id = $1 AND patient_id = $2`,
      [conditionId, patientId],
    );

    const base = baseResult.rows[0];
    if (!base) throw new NotFoundException("Condition not found");

    // All episodes of the same coded condition for this patient, each linked
    // (by date) to the encounter and clinical note documented that day.
    const episodesResult = await this.pool.query<{
      id: string;
      status: string | null;
      onset_date: string | null;
      encounter_id: string | null;
      encounter_ward: string | null;
      encounter_started_at: string | null;
      note_id: string | null;
      note_type: string | null;
      note_authored_at: string | null;
      note_author_display: string | null;
      note_content_text: string | null;
    }>(
      `SELECT c.id,
              c.status,
              c.onset_date::text AS onset_date,
              e.id AS encounter_id,
              e.ward AS encounter_ward,
              e.started_at::text AS encounter_started_at,
              d.id AS note_id,
              d.type AS note_type,
              d.authored_at::text AS note_authored_at,
              d.author_display AS note_author_display,
              d.content_text AS note_content_text
       FROM hospital.condition c
       LEFT JOIN LATERAL (
         SELECT id, ward, started_at
         FROM hospital.encounter
         WHERE patient_id = c.patient_id
           AND started_at::date = c.onset_date
         ORDER BY started_at
         LIMIT 1
       ) e ON true
       LEFT JOIN LATERAL (
         SELECT id, type, authored_at, author_display, content_text
         FROM hospital.document_reference
         WHERE patient_id = c.patient_id
           AND authored_at::date = c.onset_date
         ORDER BY authored_at
         LIMIT 1
       ) d ON true
       WHERE c.patient_id = $1
         AND c.code IS NOT DISTINCT FROM $2
         AND c.code_system IS NOT DISTINCT FROM $3
       ORDER BY c.onset_date DESC NULLS LAST`,
      [patientId, base.code, base.code_system],
    );

    const episodes: ConditionEpisode[] = episodesResult.rows.map((r) => ({
      id: r.id,
      status: r.status,
      onset_date: r.onset_date,
      encounter: r.encounter_id
        ? {
            id: r.encounter_id,
            ward: r.encounter_ward,
            started_at: r.encounter_started_at,
          }
        : null,
      note: r.note_id
        ? {
            id: r.note_id,
            type: r.note_type,
            authored_at: r.note_authored_at,
            author_display: r.note_author_display,
            content_text: r.note_content_text,
          }
        : null,
    }));

    return {
      code: {
        system: base.code_system,
        code: base.code,
        display: base.code_display,
      },
      episodes,
    };
  }

  // ─── Document ─────────────────────────────────────────────────────────────

  async getDocument(
    userId: string,
    patientId: string,
    docId: string,
  ): Promise<DocumentItem> {
    await this.scopeService.assertPatientInScope(userId, patientId);

    const result = await this.pool.query<DocumentItem>(
      `SELECT id, type, authored_at::text as authored_at, author_display, content_text
       FROM hospital.document_reference
       WHERE id = $1 AND patient_id = $2`,
      [docId, patientId],
    );

    const doc = result.rows[0];
    if (!doc) throw new NotFoundException("Document not found");
    return doc;
  }

  // ─── Encounters ───────────────────────────────────────────────────────────

  async listEncounters(
    userId: string,
    patientId: string,
  ): Promise<CursorPage<EncounterItem>> {
    await this.scopeService.assertPatientInScope(userId, patientId);

    const result = await this.pool.query<EncounterItem>(
      `SELECT id, encounter_type, status,
              started_at::text as started_at, ended_at::text as ended_at, ward
       FROM hospital.encounter
       WHERE patient_id = $1
       ORDER BY started_at DESC NULLS LAST`,
      [patientId],
    );

    return { data: result.rows, next_cursor: null, total: result.rows.length };
  }
}
