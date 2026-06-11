/**
 * HandoffService -- structured assembly of handoff summaries.
 *
 * No model calls. Data assembled directly from hospital.* tables.
 * Blocklist filter runs as defense-in-depth even on structured text.
 */

import { Injectable, Logger, Inject, NotFoundException } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import {
  formatHandoffText,
  type HandoffSections,
  type ProvenanceItem,
} from "./handoff-formatter";
import type { UserId } from "@clinical-copilot/shared-types";

const HANDOFF_DISCLAIMER =
  "Reproduces documented information from the patient record. For clinician reference only. Not a clinical assessment.";

// Vital LOINC-like codes that are reproduced verbatim
const VITAL_CODES = ["8867-4", "85354-9", "8310-5", "59408-5", "9279-1"];

export type HandoffScope = "current_shift" | "last_24h";

export interface HandoffOutput {
  readonly id: string;
  readonly patient_id: string;
  readonly ward_id: string | null;
  readonly generated_at: string;
  readonly language: string;
  readonly scope: HandoffScope;
  readonly text: string;
  readonly sections: HandoffSections;
  readonly provenance: readonly ProvenanceItem[];
  readonly disclaimer: string;
}

export interface WardHandoffOutput {
  readonly ward_id: string;
  readonly scope: HandoffScope;
  readonly language: string;
  readonly generated_at: string;
  readonly patient_count: number;
  readonly handoffs: readonly HandoffOutput[];
}

// Simple blocklist check -- mirrors the Python blocklist patterns for defense in depth
const BLOCKLIST_PATTERNS: readonly RegExp[] = [
  /\bworsening\b/i,
  /\bimproving\b/i,
  /\bconcerning\b/i,
  /\btrendin(g|gs)\b/i,
  /\belevated\b/i,
  /\bnormal\b/i,
  /\babnormal\b/i,
  /\bsuggests?\b/i,
  /\bindicates?\b/i,
  /\bconsistent with\b/i,
  /\bsignificant(ly)?\b/i,
  /\bcritical\b/i,
  /\bdeteriorat/i,
  /\bimprove[sd]?\b/i,
  /\brisk\b/i,
  /\bdiagnos/i,
  /\brecommend/i,
  /\bwarning\b/i,
];

function blocklistCheck(text: string): boolean {
  return BLOCKLIST_PATTERNS.some((re) => re.test(text));
}

@Injectable()
export class HandoffService {
  private readonly logger = new Logger(HandoffService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async generateForPatient(options: {
    patientId: string;
    userId: string;
    scope: HandoffScope;
    language: string;
  }): Promise<HandoffOutput> {
    const { patientId, userId, scope, language } = options;
    const windowMs = scope === "current_shift" ? 12 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - windowMs);

    // Verify patient exists
    const patientRow = await this.pool.query<{
      id: string;
      mrn: string | null;
      display_name: string | null;
      date_of_birth: string | null;
      sex: string | null;
      preferred_language: string | null;
    }>(
      `SELECT id, mrn, display_name, date_of_birth::text, sex, preferred_language
       FROM hospital.patient WHERE id = $1`,
      [patientId],
    );

    if (patientRow.rows.length === 0) {
      throw new NotFoundException("Patient not found");
    }

    const patient = patientRow.rows[0]!;

    // Fetch active encounter
    const encounterRow = await this.pool.query<{
      id: string;
      encounter_type: string | null;
      status: string | null;
      started_at: string | null;
      ward: string | null;
    }>(
      `SELECT id, encounter_type, status, started_at::text, ward
       FROM hospital.encounter
       WHERE patient_id = $1 AND status IN ('in-progress','active')
       ORDER BY started_at DESC LIMIT 1`,
      [patientId],
    );

    const encounter = encounterRow.rows[0] ?? null;
    const wardId = encounter?.ward ?? null;

    const provenance: ProvenanceItem[] = [];

    // --- Section 1: Identity and admission ---
    const identityItems: string[] = [];
    identityItems.push(`Name: ${patient.display_name ?? "Unknown"}`);
    provenance.push({ section: "identity_and_admission", row_index: 0, source_type: "patient", source_id: patient.id, field: "display_name" });

    if (patient.mrn) {
      identityItems.push(`MRN: ${patient.mrn}`);
    }
    if (patient.date_of_birth) {
      identityItems.push(`DOB: ${patient.date_of_birth}`);
    }
    if (patient.sex) {
      identityItems.push(`Sex: ${patient.sex}`);
    }
    if (encounter) {
      identityItems.push(`Encounter: ${encounter.encounter_type ?? "Inpatient"} -- ${encounter.status ?? ""}, admitted ${encounter.started_at ?? "unknown"}`);
      provenance.push({ section: "identity_and_admission", row_index: identityItems.length - 1, source_type: "encounter", source_id: encounter.id, field: "status" });
    }
    if (wardId) {
      identityItems.push(`Ward: ${wardId}`);
    }

    // --- Section 2: Documented today (notes and observations in window) ---
    const docRows = await this.pool.query<{
      id: string;
      type: string | null;
      authored_at: string | null;
      author_display: string | null;
      content_text: string | null;
    }>(
      `SELECT id, type, authored_at::text, author_display, content_text
       FROM hospital.document_reference
       WHERE patient_id = $1 AND authored_at >= $2
       ORDER BY authored_at DESC
       LIMIT 20`,
      [patientId, since.toISOString()],
    );

    const documentedToday: string[] = docRows.rows.map((row, i) => {
      provenance.push({ section: "documented_today", row_index: i, source_type: "document_reference", source_id: row.id, field: "content_text" });
      const preview = row.content_text
        ? row.content_text.slice(0, 200).replace(/\n/g, " ")
        : "(no content)";
      return `[${row.authored_at ?? ""}] ${row.type ?? "Note"} by ${row.author_display ?? "Unknown"}: ${preview}`;
    });

    // --- Section 3: Current medications ---
    const medRows = await this.pool.query<{
      id: string;
      medication_display: string | null;
      code: string | null;
      dose: string | null;
      route: string | null;
      frequency: string | null;
      status: string | null;
    }>(
      `SELECT id, medication_display, code, dose, route, frequency, status
       FROM hospital.medication_request
       WHERE patient_id = $1 AND status = 'active'
       ORDER BY medication_display ASC
       LIMIT 50`,
      [patientId],
    );

    const currentMedications: string[] = medRows.rows.map((row, i) => {
      provenance.push({ section: "current_medications", row_index: i, source_type: "medication_request", source_id: row.id, field: "medication_display" });
      const parts = [row.medication_display ?? row.code ?? "Unknown medication"];
      if (row.dose) parts.push(row.dose);
      if (row.route) parts.push(row.route);
      if (row.frequency) parts.push(row.frequency);
      return parts.join(" -- ");
    });

    // --- Section 4: Recent vitals (last value per code) ---
    const vitalRows = await this.pool.query<{
      id: string;
      code: string | null;
      code_display: string | null;
      value_numeric: number | null;
      value_text: string | null;
      unit: string | null;
      ref_range_low: number | null;
      ref_range_high: number | null;
      ref_range_text: string | null;
      effective_at: string | null;
    }>(
      `SELECT DISTINCT ON (code) id, code, code_display, value_numeric, value_text,
              unit, ref_range_low, ref_range_high, ref_range_text, effective_at::text
       FROM hospital.observation
       WHERE patient_id = $1
         AND category = 'vital-signs'
         AND code = ANY($2)
       ORDER BY code, effective_at DESC`,
      [patientId, VITAL_CODES],
    );

    const recentVitals: string[] = vitalRows.rows.map((row, i) => {
      provenance.push({ section: "recent_vitals", row_index: i, source_type: "observation", source_id: row.id, field: "value_numeric" });
      const label = row.code_display ?? row.code ?? "Unknown";
      const value = row.value_numeric !== null
        ? `${row.value_numeric}${row.unit ? " " + row.unit : ""}`
        : (row.value_text ?? "N/A");
      const refRange = row.ref_range_low !== null && row.ref_range_high !== null
        ? ` [${row.ref_range_low}–${row.ref_range_high}${row.unit ? " " + row.unit : ""}]`
        : row.ref_range_text
        ? ` [${row.ref_range_text}]`
        : "";
      return `${label}: ${value}${refRange} (${row.effective_at ?? "date unknown"})`;
    });

    // --- Section 5: Recent labs (last value per code) ---
    const labRows = await this.pool.query<{
      id: string;
      code: string | null;
      code_display: string | null;
      value_numeric: number | null;
      value_text: string | null;
      unit: string | null;
      ref_range_low: number | null;
      ref_range_high: number | null;
      ref_range_text: string | null;
      effective_at: string | null;
    }>(
      `SELECT DISTINCT ON (code) id, code, code_display, value_numeric, value_text,
              unit, ref_range_low, ref_range_high, ref_range_text, effective_at::text
       FROM hospital.observation
       WHERE patient_id = $1
         AND category = 'laboratory'
         AND effective_at >= $2
       ORDER BY code, effective_at DESC
       LIMIT 30`,
      [patientId, since.toISOString()],
    );

    const recentLabs: string[] = labRows.rows.map((row, i) => {
      provenance.push({ section: "recent_labs", row_index: i, source_type: "observation", source_id: row.id, field: "value_numeric" });
      const label = row.code_display ?? row.code ?? "Unknown";
      const value = row.value_numeric !== null
        ? `${row.value_numeric}${row.unit ? " " + row.unit : ""}`
        : (row.value_text ?? "N/A");
      const refRange = row.ref_range_low !== null && row.ref_range_high !== null
        ? ` [${row.ref_range_low}–${row.ref_range_high}${row.unit ? " " + row.unit : ""}]`
        : row.ref_range_text
        ? ` [${row.ref_range_text}]`
        : "";
      return `${label}: ${value}${refRange} (${row.effective_at ?? "date unknown"})`;
    });

    // --- Section 6: Pending orders ---
    const orderRows = await this.pool.query<{
      id: string;
      type: string | null;
      authored_at: string | null;
      content_text: string | null;
    }>(
      `SELECT id, type, authored_at::text, content_text
       FROM hospital.document_reference
       WHERE patient_id = $1
         AND type IN ('ServiceRequest', 'order')
         AND authored_at >= $2
       ORDER BY authored_at DESC
       LIMIT 20`,
      [patientId, since.toISOString()],
    );

    const pendingOrders: string[] = orderRows.rows.map((row, i) => {
      provenance.push({ section: "pending_orders", row_index: i, source_type: "document_reference", source_id: row.id, field: "content_text" });
      const preview = row.content_text
        ? row.content_text.slice(0, 150).replace(/\n/g, " ")
        : "(no content)";
      return `[${row.authored_at ?? ""}] ${row.type ?? "Order"}: ${preview}`;
    });

    const sections: HandoffSections = {
      identity_and_admission: identityItems,
      documented_today: documentedToday,
      current_medications: currentMedications,
      recent_vitals: recentVitals,
      recent_labs: recentLabs,
      pending_orders: pendingOrders,
    };

    const text = formatHandoffText(sections);

    // Blocklist defense-in-depth
    if (blocklistCheck(text)) {
      this.logger.warn({
        event: "handoff_blocklist_triggered",
        patient_id: patientId,
      });
    }

    // Persist to app.handoff_output
    const insertResult = await this.pool.query<{ id: string; created_at: Date }>(
      `INSERT INTO app.handoff_output
         (patient_id, ward_id, generated_by_user_id, scope, language, text,
          sections_json, provenance_json, blocklist_retries, disclaimer)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9)
       RETURNING id, created_at`,
      [
        patientId,
        wardId,
        userId,
        scope,
        language,
        text,
        JSON.stringify(sections),
        JSON.stringify(provenance),
        HANDOFF_DISCLAIMER,
      ],
    );

    const row = insertResult.rows[0]!;

    return {
      id: row.id,
      patient_id: patientId,
      ward_id: wardId,
      generated_at: row.created_at.toISOString(),
      language,
      scope,
      text,
      sections,
      provenance,
      disclaimer: HANDOFF_DISCLAIMER,
    };
  }

  async generateForWard(options: {
    wardId: string;
    userId: string;
    scope: HandoffScope;
    language: string;
  }): Promise<WardHandoffOutput> {
    const { wardId, userId, scope, language } = options;

    // Find all active patients in ward (limit 20)
    const patientRows = await this.pool.query<{ id: string }>(
      `SELECT DISTINCT p.id
       FROM hospital.patient p
       JOIN hospital.encounter e ON e.patient_id = p.id
       WHERE e.ward = $1
         AND e.status IN ('in-progress', 'active')
       LIMIT 20`,
      [wardId],
    );

    const patientIds = patientRows.rows.map((r) => r.id);

    // Concurrent generation
    const results = await Promise.all(
      patientIds.map((patientId) =>
        this.generateForPatient({ patientId, userId, scope, language }).catch((err: unknown) => {
          this.logger.error({
            event: "ward_handoff_patient_error",
            patient_id: patientId,
            error: err instanceof Error ? err.message : String(err),
          });
          return null;
        }),
      ),
    );

    const handoffs = results.filter((h): h is HandoffOutput => h !== null);

    return {
      ward_id: wardId,
      scope,
      language,
      generated_at: new Date().toISOString(),
      patient_count: handoffs.length,
      handoffs,
    };
  }
}
