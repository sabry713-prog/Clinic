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

export type DocumentType = "discharge_summary" | "referral_letter" | "transfer_note" | "visit_summary" | "encounter_note";
export type Specialty = "general" | "cardiology" | "orthopedics" | "pediatrics" | "obstetrics_gynecology" | "emergency_medicine";
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
    { key: "assessment", title: "Assessment", policy: "clinician_authored_only", prefill: false },
    { key: "plan", title: "Plan / Follow-up", policy: "clinician_authored_only", prefill: false },
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
  // Ambient structured-transcription capture (docs/prompts/ambient-segmentation-prompt.md):
  // every section here is clinician-authored-only, normally filled by
  // prefillSections from an ambient-capture transcript (see generate()) --
  // same verbatim-substring guarantee as every other CAO section, just sourced
  // from a recorded encounter instead of a typed/dictated note.
  encounter_note: [
    { key: "identity", title: "Identity", policy: "assembled_facts" },
    { key: "chief_complaint", title: "Chief Complaint", policy: "clinician_authored_only", prefill: false },
    { key: "history", title: "History", policy: "clinician_authored_only", prefill: false },
    { key: "assessment", title: "Assessment", policy: "clinician_authored_only", prefill: false },
    { key: "plan", title: "Plan", policy: "clinician_authored_only", prefill: false },
  ],
};

// Arabic section titles (values stay verbatim; only structure is localized).
const TITLE_AR: Record<string, string> = {
  "Identity and Admission": "الهوية وبيانات الدخول",
  "Identity": "الهوية",
  "Documented Problems": "المشاكل الموثقة",
  "Active Problems": "المشاكل النشطة",
  "Medications on Discharge": "الأدوية عند الخروج",
  "Current Medications": "الأدوية الحالية",
  "Medications": "الأدوية",
  "Results": "النتائج",
  "Relevant History": "التاريخ ذو الصلة",
  "Assessment": "التقييم",
  "Plan / Follow-up": "الخطة / المتابعة",
  "Plan": "الخطة",
  "Reason for Referral": "سبب الإحالة",
  "Reason for Transfer": "سبب التحويل",
  "Clinical Question": "السؤال السريري",
  "Allergies": "الحساسيات",
  "Chief Complaint": "الشكوى الرئيسية",
  "History": "التاريخ المرضي",
};

// Specialty section templates (E-Backlog): per-key title overrides only — no
// change to which facts are assembled, how they're assembled, or the
// clinician-authored-only policy. Purely note-format terminology, matching
// the competitive-assessment classification "Templating / terminology only;
// no judgment." A key with no override for a given specialty keeps the
// generic title. "general" (or an unrecognized specialty) always keeps the
// unmodified generic template, so default draft generation is unaffected.
const SPECIALTY_TITLE_OVERRIDES: Partial<Record<Specialty, Partial<Record<string, { en: string; ar: string }>>>> = {
  cardiology: {
    problems: { en: "Cardiac Problem List", ar: "قائمة المشاكل القلبية" },
    medications: { en: "Cardiac Medications", ar: "الأدوية القلبية" },
    results: { en: "Cardiac & Laboratory Results", ar: "نتائج القلب والمختبر" },
  },
  orthopedics: {
    problems: { en: "Musculoskeletal Problem List", ar: "قائمة مشاكل الجهاز الحركي" },
    results: { en: "Imaging & Laboratory Results", ar: "نتائج التصوير والمختبر" },
  },
  pediatrics: {
    problems: { en: "Pediatric Problem List", ar: "قائمة المشاكل عند الأطفال" },
  },
  obstetrics_gynecology: {
    problems: { en: "Gynecologic / Obstetric Problem List", ar: "قائمة مشاكل النساء والولادة" },
    history: { en: "Obstetric & Gynecologic History", ar: "تاريخ النساء والولادة" },
  },
  emergency_medicine: {
    reason: { en: "Reason for ED Presentation", ar: "سبب زيارة الطوارئ" },
    results: { en: "ED Results", ar: "نتائج الطوارئ" },
  },
};

export const SPECIALTIES: readonly Specialty[] = [
  "general", "cardiology", "orthopedics", "pediatrics", "obstetrics_gynecology", "emergency_medicine",
];

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
  async transcribe(userId: string, patientId: string, audioBase64: string, language: string): Promise<{ text: string; raw_text: string; engine: string; reformat: string }> {
    await this.scope.assertPatientInScope(userId, patientId);
    const url = process.env["TRANSCRIPTION_SERVICE_URL"] ?? "http://127.0.0.1:5003";
    const res = await fetch(`${url}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio_base64: audioBase64, language }),
    });
    if (!res.ok) throw new BadRequestException("Transcription failed");
    return (await res.json()) as { text: string; raw_text: string; engine: string; reformat: string };
  }

  /** Faithfully polish text the clinician TYPED (same rules as dictation). */
  async reformat(userId: string, patientId: string, text: string, language: string): Promise<{ text: string; raw_text: string; reformat: string }> {
    await this.scope.assertPatientInScope(userId, patientId);
    const url = process.env["TRANSCRIPTION_SERVICE_URL"] ?? "http://127.0.0.1:5003";
    const res = await fetch(`${url}/reformat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language }),
    });
    if (!res.ok) throw new BadRequestException("Reformat failed");
    return (await res.json()) as { text: string; raw_text: string; reformat: string };
  }

  /**
   * @param prefill Ambient-capture prefill (docs/prompts/ambient-segmentation-prompt.md):
   *   for each clinician-authored-only section whose key appears in
   *   `sections`, uses that text instead of the stored-notes lookup -- but
   *   ALWAYS re-validates it with isClinicianAuthoredOnly against `transcript`
   *   (not hospital.document_reference, since this content came from a live
   *   recording, not a stored note). A section that fails this check throws,
   *   exactly like a stored-note violation does today -- the guarantee is
   *   identical regardless of where the clinician's words came from.
   */
  async generate(
    userId: string,
    patientId: string,
    documentType: DocumentType,
    language: string,
    specialty: Specialty = "general",
    prefill?: { transcript: string; sections: Record<string, string> },
  ): Promise<DraftRow> {
    await this.scope.assertPatientInScope(userId, patientId);
    const baseTemplate = TEMPLATES[documentType];
    if (!baseTemplate) throw new BadRequestException("Unknown document_type");

    // Specialty templates (E-Backlog): "general" is byte-identical to the
    // base template. Other specialties insert an Allergies section (currently
    // missing from every generic template despite being universally relevant)
    // right after Identity — still a plain assembled-facts reproduction, same
    // as every other section.
    const template: SectionDef[] = specialty === "general"
      ? baseTemplate
      : (() => {
          const idx = baseTemplate.findIndex((s) => s.key === "identity");
          const withAllergies = [...baseTemplate];
          withAllergies.splice(idx + 1, 0, { key: "allergies", title: "Allergies", policy: "assembled_facts" });
          return withAllergies;
        })();

    // Clinician-authored source (verbatim notes) — the only permitted content
    // for clinician-authored-only sections.
    const authoredSource = await this.authoredSource(patientId);

    const sections: DraftSection[] = [];
    for (const def of template) {
      let text: string;
      const override = SPECIALTY_TITLE_OVERRIDES[specialty]?.[def.key];
      const baseTitle = override?.en ?? def.title;
      const title = language === "ar" ? (override?.ar ?? TITLE_AR[baseTitle] ?? baseTitle) : baseTitle;
      const prefillText = def.policy === "clinician_authored_only" ? prefill?.sections[def.key] : undefined;
      if (def.policy === "assembled_facts") {
        text = await this.assembleFacts(patientId, def.key, language);
      } else if (prefillText !== undefined) {
        text = prefillText;
        if (!isClinicianAuthoredOnly(text, prefill!.transcript)) {
          throw new BadRequestException(
            `Section '${def.key}' prefill is not a verbatim substring of the source transcript`,
          );
        }
      } else if (def.prefill === false) {
        // Dictate-fresh: start empty so the clinician dictates THIS encounter's
        // content (e.g. a new visit's Assessment/Plan). No old notes bleed in.
        text = language === "ar"
          ? `(أملِ أو اكتب ${title} هنا.)`
          : `(Dictate or type the ${title} here.)`;
      } else {
        // Reproduce the clinician's existing authored note verbatim.
        text = this.authoredText(authoredSource, def.key, language);
        if (!isClinicianAuthoredOnly(text, authoredSource)) {
          throw new BadRequestException(
            `Section '${def.key}' violates clinician-authored-only policy`,
          );
        }
      }
      sections.push({ ...def, title, text });
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
         (patient_id, document_type, language, specialty, sections_json, generated_text,
          blocklist_triggered, disclaimer, generated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING ${DRAFT_COLS}`,
      [patientId, documentType, language, specialty, JSON.stringify(sections), generated, blocked, disclaimer, userId],
    );
    return res.rows[0]!;
  }

  // List this patient's drafts + signed documents (newest first).
  async listForPatient(userId: string, patientId: string): Promise<Array<{ id: string; document_type: string; language: string; status: string; created_at: string; signed_at: string | null }>> {
    await this.scope.assertPatientInScope(userId, patientId);
    const res = await this.pool.query(
      `SELECT id, document_type, language, status, created_at::text, signed_at::text
         FROM app.document_draft WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [patientId]);
    return res.rows;
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
  // Structural labels localize; clinical values stay verbatim (CLAUDE.md §8).
  private async assembleFacts(patientId: string, key: string, language: string): Promise<string> {
    const ar = language === "ar";
    const none = ar ? "(لا يوجد توثيق.)" : "(None documented.)";
    const sep = ar ? "، " : ", ";
    if (key === "identity") {
      const r = await this.pool.query(
        `SELECT display_name, mrn, date_of_birth::text, sex FROM hospital.patient WHERE id=$1`, [patientId]);
      const p = r.rows[0]; if (!p) return none;
      const sex = ar ? ({ male: "ذكر", female: "أنثى" } as Record<string, string>)[String(p.sex).toLowerCase()] ?? p.sex : p.sex;
      return ar
        ? `${p.display_name ?? "غير معروف"} (رقم الملف: ${p.mrn ?? "—"}، تاريخ الميلاد: ${p.date_of_birth ?? "—"}، الجنس: ${sex ?? "—"}).`
        : `${p.display_name ?? "Unknown"} (MRN: ${p.mrn ?? "—"}, DOB: ${p.date_of_birth ?? "—"}, sex: ${sex ?? "—"}).`;
    }
    if (key === "problems" || key === "history") {
      const r = await this.pool.query(
        `SELECT code_display, status, onset_date::text FROM hospital.condition WHERE patient_id=$1 ORDER BY onset_date DESC NULLS LAST LIMIT 30`, [patientId]);
      if (!r.rows.length) return none;
      return r.rows.map((c) => {
        const parts = [String(c.code_display)];
        parts.push(ar ? `الحالة: ${c.status}` : `status: ${c.status}`);
        if (c.onset_date) parts.push(ar ? `تاريخ البدء: ${c.onset_date}` : `onset: ${c.onset_date}`);
        return `- ${parts.join(sep)}.`;
      }).join("\n");
    }
    if (key === "medications") {
      const r = await this.pool.query(
        `SELECT DISTINCT medication_display, dose, route, frequency FROM hospital.medication_request WHERE patient_id=$1 AND status='active'`, [patientId]);
      return r.rows.length ? r.rows.map((m) => `- ${[m.medication_display, m.dose, m.route, m.frequency].filter(Boolean).join(" ")}.`).join("\n") : none;
    }
    if (key === "results") {
      const r = await this.pool.query(
        `SELECT DISTINCT ON (code) code_display, value_numeric, value_text, unit, ref_range_low, ref_range_high, effective_at::text
           FROM hospital.observation WHERE patient_id=$1 AND category='laboratory' ORDER BY code, effective_at DESC LIMIT 20`, [patientId]);
      if (!r.rows.length) return none;
      return r.rows.map((o) => {
        const v = o.value_numeric !== null ? `${o.value_numeric}${o.unit ? " " + o.unit : ""}` : (o.value_text ?? "—");
        const ref = o.ref_range_low !== null && o.ref_range_high !== null
          ? (ar ? ` (المرجع: ${o.ref_range_low}-${o.ref_range_high})` : ` (ref: ${o.ref_range_low}-${o.ref_range_high})`)
          : "";
        return `- ${o.code_display}: ${v}${ref} (${o.effective_at ?? "—"}).`;
      }).join("\n");
    }
    if (key === "allergies") {
      // Reaction term reproduced verbatim only -- no severity adjective, same
      // rule as the narrative prompt (docs/prompts/narrative-prompt.md §3).
      const r = await this.pool.query(
        `SELECT code_display, reaction, recorded_at::text FROM hospital.allergy_intolerance WHERE patient_id=$1 ORDER BY recorded_at DESC NULLS LAST`, [patientId]);
      if (!r.rows.length) return none;
      return r.rows.map((a) => {
        const parts = [String(a.code_display)];
        if (a.reaction) parts.push(ar ? `التفاعل: ${a.reaction}` : `reaction: ${a.reaction}`);
        if (a.recorded_at) parts.push(ar ? `تاريخ التسجيل: ${a.recorded_at}` : `recorded: ${a.recorded_at}`);
        return `- ${parts.join(sep)}.`;
      }).join("\n");
    }
    return none;
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

const DRAFT_COLS = `id, patient_id, document_type, language, specialty, status, sections_json,
  generated_text, edited_text, blocklist_triggered, disclaimer,
  generated_by, signed_by, signed_at::text AS signed_at, signed_text,
  created_at::text AS created_at`;

export interface DraftRow {
  id: string;
  patient_id: string;
  document_type: string;
  language: string;
  specialty: string;
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
