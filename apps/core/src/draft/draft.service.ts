/**
 * DraftService (E6) — grounded document drafting lifecycle.
 *
 * Generation here assembles ONLY documented facts (assembled-facts sections)
 * and the clinician's own authored notes verbatim (clinician-authored-only
 * sections). It does NOT use a generative model prompt — the richer
 * draft-prompt.md path is gated on §6 approval. A draft is unsigned and cannot
 * be exported until an explicit, audited sign-off.
 */
import { Injectable, Inject, NotFoundException, BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { PatientScopeService } from "../patient/patient-scope.service";

export type DocumentType = "discharge_summary" | "referral_letter" | "transfer_note" | "visit_summary";
type Policy = "assembled_facts" | "clinician_authored_only";

interface SectionDef { key: string; title: string; policy: Policy; }
export interface DraftSection extends SectionDef { text: string; }

// Section templates per document type (mirrors docs/prompts/draft-prompt.md).
const TEMPLATES: Record<DocumentType, SectionDef[]> = {
  discharge_summary: [
    { key: "identity", title: "Identity and Admission", policy: "assembled_facts" },
    { key: "problems", title: "Documented Problems", policy: "assembled_facts" },
    { key: "medications", title: "Medications on Discharge", policy: "assembled_facts" },
    { key: "results", title: "Results", policy: "assembled_facts" },
    { key: "assessment", title: "Assessment", policy: "clinician_authored_only" },
    { key: "plan", title: "Plan / Follow-up", policy: "clinician_authored_only" },
  ],
  referral_letter: [
    { key: "identity", title: "Identity", policy: "assembled_facts" },
    { key: "reason", title: "Reason for Referral", policy: "clinician_authored_only" },
    { key: "history", title: "Relevant History", policy: "assembled_facts" },
    { key: "medications", title: "Current Medications", policy: "assembled_facts" },
    { key: "question", title: "Clinical Question", policy: "clinician_authored_only" },
  ],
  transfer_note: [
    { key: "identity", title: "Identity and Admission", policy: "assembled_facts" },
    { key: "problems", title: "Active Problems", policy: "assembled_facts" },
    { key: "medications", title: "Medications", policy: "assembled_facts" },
    { key: "reason", title: "Reason for Transfer", policy: "clinician_authored_only" },
  ],
  visit_summary: [
    { key: "identity", title: "Identity", policy: "assembled_facts" },
    { key: "results", title: "Results", policy: "assembled_facts" },
    { key: "medications", title: "Medications", policy: "assembled_facts" },
    { key: "assessment", title: "Assessment", policy: "clinician_authored_only" },
    { key: "plan", title: "Plan", policy: "clinician_authored_only" },
  ],
};

// Defense-in-depth blocklist (mirrors handoff.service).
const BLOCKLIST = [
  /\bworsening\b/i, /\bimproving\b/i, /\bconcerning\b/i, /\belevated\b/i, /\bnormal\b/i,
  /\babnormal\b/i, /\bsuggests?\b/i, /\bindicates?\b/i, /\bconsistent with\b/i,
  /\bsignificant(ly)?\b/i, /\bcritical\b/i, /\brisk\b/i, /\bdiagnos/i, /\brecommend/i,
];

@Injectable()
export class DraftService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly scope: PatientScopeService,
  ) {}

  private blocklistHit(text: string): boolean {
    return BLOCKLIST.some((re) => re.test(text));
  }

  async generate(userId: string, patientId: string, documentType: DocumentType, language: string): Promise<DraftRow> {
    await this.scope.assertPatientInScope(userId, patientId);
    const template = TEMPLATES[documentType];
    if (!template) throw new BadRequestException("Unknown document_type");

    const sections: DraftSection[] = [];
    for (const def of template) {
      const text = def.policy === "assembled_facts"
        ? await this.assembleFacts(patientId, def.key)
        : await this.authoredText(patientId, def.key, language);
      sections.push({ ...def, text });
    }

    const generated = sections.map((s) => `## ${s.title}\n${s.text}`).join("\n\n");
    const blocked = this.blocklistHit(
      // only assembled-facts sections are model-style prose; CAO is clinician's own words
      sections.filter((s) => s.policy === "assembled_facts").map((s) => s.text).join("\n"),
    );
    const disclaimer = language === "ar"
      ? "مسودة غير موقعة. يُعيد إنتاج معلومات موثقة من السجل. للمراجعة والتعديل والتوقيع من قِبَل الطبيب."
      : "Unsigned draft. Reproduces documented record information. For clinician review, editing, and sign-off.";

    const res = await this.pool.query<DraftRow>(
      `INSERT INTO app.document_draft
         (patient_id, document_type, language, sections_json, generated_text,
          blocklist_triggered, disclaimer, generated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING ${DRAFT_COLS}`,
      [patientId, documentType, language, JSON.stringify(sections), generated, blocked, disclaimer, userId],
    );
    return res.rows[0]!;
  }

  async get(userId: string, draftId: string): Promise<DraftRow> {
    const res = await this.pool.query<DraftRow>(
      `SELECT ${DRAFT_COLS} FROM app.document_draft WHERE id = $1`, [draftId]);
    const row = res.rows[0];
    if (!row) throw new NotFoundException("Draft not found");
    await this.scope.assertPatientInScope(userId, row.patient_id);
    return row;
  }

  async update(userId: string, draftId: string, editedText: string): Promise<DraftRow> {
    const draft = await this.get(userId, draftId);
    if (draft.status === "signed") throw new BadRequestException("Cannot edit a signed draft");
    const res = await this.pool.query<DraftRow>(
      `UPDATE app.document_draft SET edited_text = $2, updated_at = now()
        WHERE id = $1 RETURNING ${DRAFT_COLS}`, [draftId, editedText]);
    return res.rows[0]!;
  }

  async sign(userId: string, draftId: string): Promise<DraftRow> {
    const draft = await this.get(userId, draftId);
    if (draft.status === "signed") throw new BadRequestException("Draft already signed");
    const frozen = draft.edited_text ?? draft.generated_text;
    const res = await this.pool.query<DraftRow>(
      `UPDATE app.document_draft
          SET status='signed', signed_by=$2, signed_at=now(), signed_text=$3, updated_at=now()
        WHERE id=$1 RETURNING ${DRAFT_COLS}`, [draftId, userId, frozen]);
    return res.rows[0]!;
  }

  async export(userId: string, draftId: string): Promise<{ text: string; signed_at: string | null }> {
    const draft = await this.get(userId, draftId);
    // Hard gate: a draft is a draft — unsigned drafts cannot be exported.
    if (draft.status !== "signed") {
      throw new ForbiddenException("Only signed drafts can be exported");
    }
    return { text: draft.signed_text ?? "", signed_at: draft.signed_at };
  }

  // ── assembly helpers (assembled-facts sections) ──────────────────────────
  private async assembleFacts(patientId: string, key: string): Promise<string> {
    if (key === "identity") {
      const r = await this.pool.query(
        `SELECT display_name, mrn, date_of_birth::text, sex FROM hospital.patient WHERE id=$1`, [patientId]);
      const p = r.rows[0]; if (!p) return "(Not documented.)";
      return `${p.display_name ?? "Unknown"} (MRN: ${p.mrn ?? "—"}, DOB: ${p.date_of_birth ?? "—"}, sex: ${p.sex ?? "—"}).`;
    }
    if (key === "problems" || key === "history") {
      const r = await this.pool.query(
        `SELECT code_display, status, onset_date::text FROM hospital.condition WHERE patient_id=$1 ORDER BY onset_date DESC NULLS LAST LIMIT 30`, [patientId]);
      return r.rows.length ? r.rows.map((c) => `- ${c.code_display} (status: ${c.status}${c.onset_date ? `, onset: ${c.onset_date}` : ""}).`).join("\n") : "(None documented.)";
    }
    if (key === "medications") {
      const r = await this.pool.query(
        `SELECT DISTINCT medication_display, dose, route, frequency FROM hospital.medication_request WHERE patient_id=$1 AND status='active'`, [patientId]);
      return r.rows.length ? r.rows.map((m) => `- ${[m.medication_display, m.dose, m.route, m.frequency].filter(Boolean).join(" ")}.`).join("\n") : "(None documented.)";
    }
    if (key === "results") {
      const r = await this.pool.query(
        `SELECT DISTINCT ON (code) code_display, value_numeric, value_text, unit, ref_range_low, ref_range_high, effective_at::text
           FROM hospital.observation WHERE patient_id=$1 AND category='laboratory' ORDER BY code, effective_at DESC LIMIT 20`, [patientId]);
      return r.rows.length ? r.rows.map((o) => {
        const v = o.value_numeric !== null ? `${o.value_numeric}${o.unit ? " " + o.unit : ""}` : (o.value_text ?? "—");
        const ref = o.ref_range_low !== null && o.ref_range_high !== null ? ` (ref: ${o.ref_range_low}-${o.ref_range_high})` : "";
        return `- ${o.code_display}: ${v}${ref} (${o.effective_at ?? "—"}).`;
      }).join("\n") : "(None documented.)";
    }
    return "(Not documented.)";
  }

  // ── clinician-authored-only sections: verbatim from authored notes ────────
  private async authoredText(patientId: string, key: string, language: string): Promise<string> {
    // Reproduce the most recent clinician-authored note content verbatim. The
    // model writes nothing here. If none, emit the sentinel.
    const r = await this.pool.query<{ content_text: string }>(
      `SELECT content_text FROM hospital.document_reference
        WHERE patient_id=$1 AND content_text IS NOT NULL AND type ILIKE '%note%'
        ORDER BY authored_at DESC NULLS LAST LIMIT 1`, [patientId]);
    const note = r.rows[0]?.content_text?.trim();
    if (note) return note;          // verbatim clinician text
    return language === "ar" ? `(لا يوجد ${key} موثق لإعادة إنتاجه.)` : `(No documented ${key} to reproduce.)`;
  }
}

const DRAFT_COLS = `id, patient_id, document_type, language, status, sections_json,
  generated_text, edited_text, blocklist_triggered, disclaimer,
  generated_by, signed_by, signed_at::text AS signed_at, signed_text,
  created_at::text AS created_at`;

export interface DraftRow {
  id: string;
  patient_id: string;
  document_type: string;
  language: string;
  status: string;
  sections_json: DraftSection[];
  generated_text: string;
  edited_text: string | null;
  blocklist_triggered: boolean;
  disclaimer: string | null;
  generated_by: string | null;
  signed_by: string | null;
  signed_at: string | null;
  signed_text: string | null;
  created_at: string;
}
