/**
 * ServiceRequestService — turn a clinician's DOCUMENTED service orders into
 * structured service requests.
 *
 * Boundary (CLAUDE.md §2): the system only EXTRACTS services the clinician
 * explicitly requested in a note/order (verbatim, within an ordering context),
 * and only CREATES a request after the clinician confirms it. It never decides,
 * suggests, or recommends a service the clinician did not document. Each created
 * request keeps the verbatim source excerpt for provenance.
 */
import { Injectable, Inject } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { PatientScopeService } from "../patient/patient-scope.service";

export interface ServiceCandidate {
  readonly category: string;
  readonly code_system: string | null;
  readonly code: string | null;
  readonly code_display: string;
  readonly source_type: string;
  readonly source_document_id: string | null;
  readonly source_excerpt: string;
}

export interface ServiceRequestRow {
  readonly id: string;
  readonly category: string;
  readonly code: string | null;
  readonly code_display: string;
  readonly status: string;
  readonly source_excerpt: string | null;
  readonly requested_at: string;
}

// A documented service must appear inside an ordering context to count as a
// request (not a result already filed). Sentences are matched against this.
const ORDER_CONTEXT =
  /\b(order|ordered|ordering|request|requested|requesting|arrange|arranged|arranging|refer|referred|booked?|schedule[d]?)\b/i;

// Known services and their codes. Extraction is verbatim keyword matching —
// no inference. SNOMED CT / LOINC where applicable.
const CATALOG: { re: RegExp; category: string; code_system: string; code: string; code_display: string }[] = [
  { re: /\bchest x-?rays?\b|\bcxr\b/i, category: "imaging", code_system: "http://snomed.info/sct", code: "399208008", code_display: "Chest X-ray" },
  { re: /\bx-?rays?\b/i, category: "imaging", code_system: "http://snomed.info/sct", code: "363680008", code_display: "X-ray" },
  { re: /\b(abdominal )?ultrasounds?\b|\bu\/s\b/i, category: "imaging", code_system: "http://snomed.info/sct", code: "16310003", code_display: "Ultrasound" },
  { re: /\bct\b(?:\s*scan)?/i, category: "imaging", code_system: "http://snomed.info/sct", code: "77477000", code_display: "CT scan" },
  { re: /\bmri\b/i, category: "imaging", code_system: "http://snomed.info/sct", code: "113091000", code_display: "MRI" },
  { re: /\b(ecg|ekg|electrocardiogram)\b/i, category: "procedure", code_system: "http://snomed.info/sct", code: "29303009", code_display: "Electrocardiogram (ECG)" },
  { re: /\bechocardiogra(?:m|phy)\b/i, category: "procedure", code_system: "http://snomed.info/sct", code: "40701008", code_display: "Echocardiography" },
  { re: /\b(cbc|complete blood count)\b/i, category: "laboratory", code_system: "http://snomed.info/sct", code: "26604007", code_display: "Complete blood count (CBC)" },
  { re: /\brenal (?:profile|function)\b|\bu&e\b|\burea and electrolytes\b/i, category: "laboratory", code_system: "http://snomed.info/sct", code: "302181000", code_display: "Renal profile" },
  { re: /\bcrp\b|\bc-reactive protein\b/i, category: "laboratory", code_system: "http://loinc.org", code: "1988-5", code_display: "C-reactive protein (CRP)" },
  { re: /\b(lft|liver function)\b/i, category: "laboratory", code_system: "http://snomed.info/sct", code: "26958001", code_display: "Liver function tests" },
  { re: /\blipid (?:profile|panel)\b/i, category: "laboratory", code_system: "http://snomed.info/sct", code: "16298000", code_display: "Lipid profile" },
  { re: /\bhba1c\b/i, category: "laboratory", code_system: "http://snomed.info/sct", code: "43396009", code_display: "HbA1c" },
  { re: /\b(urinalysis|urine analysis)\b/i, category: "laboratory", code_system: "http://snomed.info/sct", code: "27171005", code_display: "Urinalysis" },
  { re: /\bbaseline (?:laboratory|lab) tests?\b|\bbaseline labs\b|\bblood tests?\b/i, category: "laboratory", code_system: "http://snomed.info/sct", code: "108252007", code_display: "Baseline laboratory tests" },
];

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?؟])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

@Injectable()
export class ServiceRequestService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly scope: PatientScopeService,
  ) {}

  /**
   * Extract candidate service requests from the patient's documented orders and
   * notes (and signed drafts). Pure extraction — nothing is created here.
   */
  async extractCandidates(userId: string, patientId: string): Promise<ServiceCandidate[]> {
    await this.scope.assertPatientInScope(userId, patientId);

    const sources: { id: string; type: string; text: string }[] = [];

    const notes = await this.pool.query<{ id: string; content_text: string | null }>(
      `SELECT id, content_text FROM hospital.document_reference
        WHERE patient_id = $1 AND content_text IS NOT NULL
        ORDER BY authored_at DESC NULLS LAST LIMIT 50`,
      [patientId],
    );
    for (const n of notes.rows) sources.push({ id: n.id, type: "document_reference", text: n.content_text ?? "" });

    const drafts = await this.pool.query<{ id: string; signed_text: string | null }>(
      `SELECT id, signed_text FROM app.document_draft
        WHERE patient_id = $1 AND status = 'signed' AND signed_text IS NOT NULL
        ORDER BY signed_at DESC NULLS LAST LIMIT 20`,
      [patientId],
    );
    for (const d of drafts.rows) sources.push({ id: d.id, type: "document_draft", text: d.signed_text ?? "" });

    const seen = new Set<string>();
    const candidates: ServiceCandidate[] = [];
    for (const src of sources) {
      for (const sentence of splitSentences(src.text)) {
        if (!ORDER_CONTEXT.test(sentence)) continue;
        const matchedInSentence = new Set<string>();
        for (const item of CATALOG) {
          if (!item.re.test(sentence)) continue;
          matchedInSentence.add(item.code_display);
          // De-dupe the generic "X-ray" when a "Chest X-ray" matched the same sentence.
          if (item.code_display === "X-ray" && matchedInSentence.has("Chest X-ray")) continue;
          const key = item.code;
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push({
            category: item.category,
            code_system: item.code_system,
            code: item.code,
            code_display: item.code_display,
            source_type: src.type,
            source_document_id: src.id,
            source_excerpt: sentence,
          });
        }
      }
    }
    // If a sentence yielded both "Chest X-ray" and the generic "X-ray", drop the generic.
    if (candidates.some((c) => c.code_display === "Chest X-ray")) {
      return candidates.filter((c) => c.code_display !== "X-ray");
    }
    return candidates;
  }

  /**
   * Create service requests from clinician-CONFIRMED candidates only.
   *
   * The clinician confirms by code, but the row written is the SERVER's own
   * extraction (verbatim excerpt + source), re-derived here — so a client can
   * never inject a service that is not actually documented in the record.
   */
  async confirmAndCreate(
    userId: string,
    patientId: string,
    confirmed: ServiceCandidate[],
  ): Promise<ServiceRequestRow[]> {
    await this.scope.assertPatientInScope(userId, patientId);

    const extracted = await this.extractCandidates(userId, patientId);
    const byCode = new Map(extracted.map((c) => [c.code ?? c.code_display, c]));
    const confirmedKeys = new Set(confirmed.map((c) => c.code ?? c.code_display));
    const items = [...confirmedKeys]
      .map((k) => byCode.get(k))
      .filter((c): c is ServiceCandidate => c !== undefined);

    const created: ServiceRequestRow[] = [];
    for (const it of items) {
      const res = await this.pool.query<ServiceRequestRow>(
        `INSERT INTO app.service_request
           (patient_id, category, code_system, code, code_display, status, intent,
            source_document_id, source_type, source_excerpt, requested_by, fhir_resource_json)
         VALUES ($1,$2,$3,$4,$5,'active','order',$6,$7,$8,$9,$10::jsonb)
         RETURNING id, category, code, code_display, status, source_excerpt,
                   requested_at::text AS requested_at`,
        [
          patientId, it.category, it.code_system, it.code, it.code_display,
          it.source_document_id, it.source_type, it.source_excerpt, userId,
          JSON.stringify({ resourceType: "ServiceRequest", intent: "order" }),
        ],
      );
      created.push(res.rows[0]!);
    }
    return created;
  }

  async list(userId: string, patientId: string): Promise<ServiceRequestRow[]> {
    await this.scope.assertPatientInScope(userId, patientId);
    const res = await this.pool.query<ServiceRequestRow>(
      `SELECT id, category, code, code_display, status, source_excerpt,
              requested_at::text AS requested_at
         FROM app.service_request
        WHERE patient_id = $1
        ORDER BY requested_at DESC LIMIT 100`,
      [patientId],
    );
    return res.rows;
  }
}
