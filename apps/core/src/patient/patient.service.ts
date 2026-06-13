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

export interface BriefCondition {
  readonly code: string | null;
  readonly code_display: string | null;
  readonly status: string | null;
  readonly onset_date: string | null;
}

export interface BriefClinic {
  readonly clinic: string;
  readonly symptoms: readonly { display: string; status: string | null; onset_date: string | null }[];
  readonly treatments: readonly { display: string; dose: string | null; route: string | null; frequency: string | null; status: string | null }[];
}

export interface BriefLab {
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

export interface BriefImaging {
  readonly code_display: string | null;
  readonly value_text: string | null;
  readonly effective_at: string | null;
}

/**
 * PatientBrief — a factual reproduction of the patient's documented record,
 * organized for a quick read. It contains NO risk classification, NO severity
 * flags, and NO interpretation. "documented_conditions" lists the problem-list
 * conditions exactly as recorded; the caller forms their own judgement.
 */
export interface PatientBrief {
  readonly documented_conditions: readonly BriefCondition[];
  readonly clinics: readonly BriefClinic[];
  readonly labs: readonly BriefLab[];
  readonly imaging: readonly BriefImaging[];
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

  // ─── Patient brief ──────────────────────────────────────────────────────────

  async getPatientBrief(userId: string, patientId: string): Promise<PatientBrief> {
    await this.scopeService.assertPatientInScope(userId, patientId);

    // Problem-list conditions = documented conditions that are not per-visit
    // symptom records (those carry a "(reported at <clinic>)" suffix).
    const conditionsResult = await this.pool.query<{
      code: string | null;
      code_display: string | null;
      status: string | null;
      onset_date: string | null;
      is_symptom: boolean;
    }>(
      `SELECT code, code_display, status, onset_date::text AS onset_date,
              (code_display LIKE '%(reported at%') AS is_symptom
       FROM hospital.condition
       WHERE patient_id = $1
       ORDER BY onset_date DESC NULLS LAST`,
      [patientId],
    );

    const documented_conditions: BriefCondition[] = conditionsResult.rows
      .filter((r) => !r.is_symptom)
      .map((r) => ({
        code: r.code,
        code_display: r.code_display,
        status: r.status,
        onset_date: r.onset_date,
      }));

    // Per-clinic symptom records (parse the clinic from the display suffix).
    const clinicMap = new Map<string, BriefClinic>();
    const clinicRe = /\(reported at ([^)]+)\)/;
    const ensureClinic = (name: string): BriefClinic => {
      let c = clinicMap.get(name);
      if (!c) {
        c = { clinic: name, symptoms: [], treatments: [] };
        clinicMap.set(name, c);
      }
      return c;
    };
    for (const r of conditionsResult.rows) {
      if (!r.is_symptom || !r.code_display) continue;
      const m = clinicRe.exec(r.code_display);
      const clinic = m ? m[1]!.trim() : "Other";
      const display = r.code_display.replace(/\s*\(reported at [^)]+\)/, "").trim();
      (ensureClinic(clinic).symptoms as { display: string; status: string | null; onset_date: string | null }[]).push({
        display,
        status: r.status,
        onset_date: r.onset_date,
      });
    }

    // Clinic-prescribed treatment (medications linked to a clinic encounter).
    const medsResult = await this.pool.query<{
      medication_display: string | null;
      dose: string | null;
      route: string | null;
      frequency: string | null;
      status: string | null;
      clinic: string | null;
    }>(
      `SELECT m.medication_display, m.dose, m.route, m.frequency, m.status,
              e.ward AS clinic
       FROM hospital.medication_request m
       JOIN hospital.encounter e ON e.id = m.encounter_id
       WHERE m.patient_id = $1 AND e.ward LIKE '%Clinic'
       ORDER BY m.started_at DESC NULLS LAST`,
      [patientId],
    );
    for (const r of medsResult.rows) {
      if (!r.clinic) continue;
      (ensureClinic(r.clinic).treatments as { display: string; dose: string | null; route: string | null; frequency: string | null; status: string | null }[]).push({
        display: r.medication_display ?? "Unknown",
        dose: r.dose,
        route: r.route,
        frequency: r.frequency,
        status: r.status,
      });
    }

    const clinics = Array.from(clinicMap.values()).sort((a, b) =>
      a.clinic.localeCompare(b.clinic),
    );

    // Latest value per laboratory code — factual, with the source ref range.
    const labsResult = await this.pool.query<BriefLab>(
      `SELECT DISTINCT ON (code) code, code_display, value_numeric, value_text,
              unit, ref_range_low, ref_range_high, ref_range_text,
              effective_at::text AS effective_at
       FROM hospital.observation
       WHERE patient_id = $1 AND category = 'laboratory'
       ORDER BY code, effective_at DESC`,
      [patientId],
    );

    const imagingResult = await this.pool.query<BriefImaging>(
      `SELECT code_display, value_text, effective_at::text AS effective_at
       FROM hospital.observation
       WHERE patient_id = $1 AND category = 'imaging'
       ORDER BY effective_at DESC`,
      [patientId],
    );

    return {
      documented_conditions,
      clinics,
      labs: labsResult.rows,
      imaging: imagingResult.rows,
    };
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
