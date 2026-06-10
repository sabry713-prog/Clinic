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
