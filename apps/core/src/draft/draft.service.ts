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

// prefill (clinician-authored-only sections only):
//  true  → reproduce the clinician's existing authored note verbatim
//  false → start empty for the clinician to DICTATE this encounter's content
interface SectionDef { key: string; title: string; policy: Policy; prefill?: boolean; }
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
    { key: "reason", title: "Reason for Referral", policy: "clinician_authored_only", prefill: false },
    { key: "history", title: "Relevant History", policy: "assembled_facts" },
    { key: "medications", title: "Current Medications", policy: "assembled_facts" },
    { key: "question", title: "Clinical Question", policy: "clinician_authored_only", prefill: false },
  ],
  transfer_note: [
    { key: "identity", title: "Identity and Admission", policy: "assembled_facts" },
    { key: "problems", title: "Active Problems", policy: "assembled_facts" },
    { key: "medications", title: "Medications", policy: "assembled_facts" },
    { key: "reason", title: "Reason for Transfer", policy: "clinician_authored_only", prefill: false },
  ],
  visit_summary: [
    { key: "identity", title: "Identity", policy: "assembled_facts" },
    { key: "results", title: "Results", policy: "assembled_facts" },
    { key: "medications", title: "Medications", policy: "assembled_facts" },
    { key: "assessment", title: "Assessment", policy: "clinician_authored_only", prefill: false },
    { key: "plan", title: "Plan", policy: "clinician_authored_only", prefill: false },
  ],
};

// Defense-in-depth blocklist (mirrors handoff.service).
const BLOCKLIST = [
  /\bworsening\b/i, /\bimproving\b/i, /\bconcerning\b/i, /\belevated\b/i, /\bnormal\b/i,
  /\babnormal\b/i, /\bsuggests?\b/i, /\bindicates?\b/i, /\bconsistent with\b/i,
  /\bsignificant(ly)?\b/i, /\bcritical\b/i, /\brisk\b/i, /\bdiagnos/i, /\brecommend/i,
];

// Empty/placeholder sentinels (EN/AR) accepted in clinician-authored-only
// sections: "no documented … to reproduce" (reproduce) and "dictate/type …"
// (dictate-fresh). The clinician fills the latter live.
const SENTINEL_RE = /^\((No documented .* to reproduce\.|Dictate or type .* here\.|لا يوجد .* موثق لإعادة إنتاجه\.|أملِ أو اكتب .* هنا\.)\)$/;

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Section-policy validator (E6 exit-gate). For clinician-authored-only sections,
 * the text must be EITHER the empty sentinel OR a verbatim substring of the
 * clinician's authored source (whitespace/case-insensitive). The model may never
 * introduce new content into these sections. Pure + unit-tested.
 */
export function isClinicianAuthoredOnly(text: string, authoredSource: string): boolean {
  const t = text.trim();
  if (SENTINEL_RE.test(t)) return true;
  if (t === "") return true;
  return normalizeWs(authoredSource).includes(normalizeWs(t));
}

@Injectable()
export class DraftService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly scope: PatientScopeService,
  ) {}

  private blocklistHit(text: string): boolean {
    return BLOCKLIST.some((re) => re.test(text));
  }

  /**
   * Dictation: forward audio to the on-prem transcription service and return
   * the transcribed + light-reformatted text. The clinician is the author; no
   * clinical content is generated here. Audio is PHI — never logged/persisted.
   */
  async transcribe(userId: string, patientId: string, audioBase64: string, language: string): Promise<{ text: string; engine: string }> {
    await this.scope.assertPatientInScope(userId, patientId);
    const url = process.env["TRANSCRIPTION_SERVICE_URL"] ?? "http://127.0.0.1:5003";
    const res = await fetch(`${url}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio_base64: audioBase64, language }),
    });
    if (!res.ok) throw new BadRequestException("Transcription failed");
    return (await res.json()) as { text: string; engine: string };
  }

  async generate(userId: string, patientId: string, documentType: DocumentType, language: string): Promise<DraftRow> {
    await this.scope.assertPatientInScope(userId, patientId);
    const template = TEMPLATES[documentType];
    if (!template) throw new BadRequestException("Unknown document_type");

    // Clinician-authored source (verbatim notes) — the only permitted content
    // for clinician-authored-only sections.
    const authoredSource = await this.authoredSource(patientId);

    const sections: DraftSection[] = [];
    for (const def of template) {
      let text: string;
      if (def.policy === "assembled_facts") {
        text = await this.assembleFacts(patientId, def.key);
      } else if (def.prefill === false) {
        // Dictate-fresh: start empty so the clinician dictates THIS encounter's
        // content (e.g. a new visit's Assessment/Plan). No old notes bleed in.
        text = language === "ar"
          ? `(أملِ أو اكتب ${def.title} هنا.)`
          : `(Dictate or type the ${def.title} here.)`;
      } else {
        // Reproduce the clinician's existing authored note verbatim.
        text = this.authoredText(authoredSource, def.key, language);
        if (!isClinicianAuthoredOnly(text, authoredSource)) {
          throw new BadRequestException(
            `Section '${def.key}' violates clinician-authored-only policy`,
          );
        }
      }
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

  // Clinician-authored source corpus (verbatim notes) for the patient.
  private async authoredSource(patientId: string): Promise<string> {
    const r = await this.pool.query<{ content_text: string }>(
      `SELECT content_text FROM hospital.document_reference
        WHERE patient_id=$1 AND content_text IS NOT NULL AND type ILIKE '%note%'
        ORDER BY authored_at DESC NULLS LAST LIMIT 5`, [patientId]);
    return r.rows.map((x) => x.content_text).join("\n\n");
  }

  // ── clinician-authored-only sections: verbatim from authored notes ────────
  private authoredText(authoredSource: string, key: string, language: string): string {
    // Reproduce the most recent clinician-authored note content verbatim. The
    // model writes nothing here. If none, emit the sentinel.
    const note = authoredSource.split("\n\n")[0]?.trim();
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
