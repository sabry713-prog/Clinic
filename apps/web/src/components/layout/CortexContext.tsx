/**
 * CortexContext — mock state for the 3-pane clinical shell (Sprint 3).
 *
 * Everything here is MOCK data used to demonstrate the shell's behaviour:
 * a live-streaming transcript, an auto-updating SOAP draft, order lines with
 * NPHIES status, and the AI Team agent drawer.
 *
 * No backend calls are made from this provider. Wiring the NPHIES badges to
 * the real `check_nphies_necessity()` graph query (services/veritas-graph)
 * and the SOAP draft to `generate_soap_note()` (services/orchestrator) is
 * deliberately left to a later sprint.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAgentOrchestrator, type EvidenceChain } from "../../hooks/useAgentOrchestrator";
import { useNphiesStatus } from "../../hooks/useNphiesStatus";
import { usePatientTimeline } from "../../hooks/usePatientTimeline";
import { api } from "../../lib/api";
import { formatNurseVitals, mergeObjective, type NurseVitals } from "./vitals";
import type { PostCarePackage } from "../ai-team/ReceptionistTab";
import type { AgentHandoff } from "../../lib/api";
import { IMAGING_KEYWORDS, LAB_KEYWORDS } from "../../lib/clinicalVocabulary";

// ---------------------------------------------------------------- types
/** `blue` = pended: submitted to the payer, no decision yet (Sprint 9). */
export type NphiesStatus = "green" | "yellow" | "blue" | "red";

export type AgentId = "scribe" | "consultant" | "pharmacist" | "nphies" | "receptionist";

export interface SoapNote {
  readonly subjective: string;
  readonly objective: string;
  readonly assessment: string;
  readonly plan: string;
}

export type SoapField = keyof SoapNote;

export interface TranscriptLine {
  readonly id: string;
  readonly speaker: "clinician" | "patient";
  readonly text: string;
  readonly at: string;
}

export interface ChecklistItem {
  readonly id: string;
  readonly label: string;
  readonly done: boolean;
  /** True when auto-derived from the clinician's own dictation (the
   * Sully-style suggestion). Removable — removal is the deselect. */
  readonly proposed?: boolean;
}

export type OrderCategory = "medication" | "lab" | "imaging" | "procedure";

export interface OrderLine {
  readonly id: string;
  readonly category: OrderCategory;
  readonly display: string;
  readonly code: string;
  readonly codeSystem: string;
  readonly nphiesStatus: NphiesStatus;
  /** Why the badge is this colour — shown in the tooltip. */
  readonly nphiesDetail: string;
  /** Suggested replacement codes when the status is red. */
  readonly suggestedCodes?: readonly string[];
  /** NSCRE's own graph traversal for this status, when available (Sprint 8) — the
   * "View Evidence Chain" trigger only appears when this is set; mock order lines
   * (no live patient wired to this shell yet) simply don't have one. */
  readonly evidenceChain?: EvidenceChain;
  /** Payer authorization reference once approved (Sprint 9). Read from the
   * NPHIES response, never generated locally. */
  readonly authorizationNumber?: string | null;
  /** A pre-auth submission for this order is in flight. */
  readonly submitting?: boolean;
  /** Confirmed codes carried into the FHIR bundle verbatim (Sprint 9). */
  readonly icd10Code?: string;
  readonly icd10Display?: string;
}

export interface TimelineEntry {
  readonly id: string;
  readonly kind: "encounter" | "lab" | "note" | "medication" | "imaging";
  readonly title: string;
  readonly detail: string;
  readonly at: string;
}

export interface AgentAction {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** When true, the action has no backend — rendered as "Pending integration". */
  readonly pendingIntegration?: true;
}

/** One individually-clickable clinical assertion inside an agent message
 * (S4.1 terminal cutaway): the label names the finding, the chain is NSCRE's
 * own traversal for exactly that finding — never shared across findings. */
export interface MessageFinding {
  readonly kind: "ddi" | "dose" | "screened" | "necessity";
  readonly label: string;
  readonly evidenceChain: EvidenceChain;
}

export interface AgentMessage {
  readonly id: string;
  readonly from: AgentId;
  readonly text: string;
  readonly at: string;
  /** NSCRE's own graph traversal behind this message, when it came from a live
   * agent result (Sprint 8) — the "Show Reasoning" trigger only appears when
   * this is set. When multiple findings back one message, this is the first. */
  readonly evidenceChain?: EvidenceChain;
  /** Per-finding assertions (S4.1): each entry renders as its own clickable
   * row with the exact chain for that one finding, so a multi-finding message
   * never collapses distinct evidence into one shared trail. */
  readonly findings?: readonly MessageFinding[];
  /** Set when this message is an inter-agent handoff rather than a single
   * agent's own output (Sprint 10) -- rendered with the source -> target
   * chain so the clinician can see who passed what to whom. */
  readonly handoff?: {
    readonly sourceAgent: string;
    readonly targetAgent: string;
    readonly correlationId: string;
  };
}

/** `live` uses the microphone + on-prem transcription service; `demo` replays
 * the canned transcript. Audit H-3: the pane used to be demo-only with no way
 * to reach the real pipeline. */
export type DictationMode = "live" | "demo";

interface CortexState {
  readonly recording: boolean;
  readonly elapsedSeconds: number;
  readonly transcript: readonly TranscriptLine[];
  /** Which capture path the scribe pane is using. */
  readonly dictationMode: DictationMode;
  /** Null in demo mode -- real dictation needs a patient to post audio against. */
  readonly patientId: string | null;
  /** The encounter the shell is operating on; null when none is routed in.
   * Exposed because a preview that cannot name the encounter shows a placeholder
   * instead (audit H05) -- and a placeholder in a field asserted to be exact is
   * a fabricated value. */
  readonly encounterId: string | null;
  /** True while audio is being transcribed server-side. */
  readonly transcribing: boolean;
  /** Surfaces mic/transcription failures instead of failing silently. */
  readonly dictationError: string | null;
  setDictationMode: (mode: DictationMode) => void;
  /** Append a real transcribed utterance to the live transcript. */
  appendTranscriptLine: (text: string) => void;
  /** Who is currently speaking — set by the clinician via the toggle.
   * Single-mic recording has no diarization; the clinician explicitly
   * indicates the speaker because misattributing a symptom to the wrong
   * speaker is a clinical error the system must never make on its own. */
  readonly activeSpeaker: "clinician" | "patient";
  setActiveSpeaker: (speaker: "clinician" | "patient") => void;
  setTranscribing: (value: boolean) => void;
  setDictationError: (message: string | null) => void;
  readonly soap: SoapNote;
  /** Vitals the nurse recorded before this encounter, read from the record.
   * Null when the record holds none -- nothing is inferred. */
  readonly nurseVitals: NurseVitals | null;
  /** Set when automatic live SOAP generation failed — surfaced in the
   * scribe pane so a dead network is visible instead of silent. */
  readonly soapError: string | null;
  /** True while the live SOAP auto-generation round-trip is in flight. */
  readonly soapLoading: boolean;
  readonly checklist: readonly ChecklistItem[];
  readonly timeline: readonly TimelineEntry[];
  /** True while the real timeline is loading (Phase 2 / audit M-4). */
  readonly timelineLoading: boolean;
  /** Set when one of the three timeline sources failed; the rest still show. */
  readonly timelineError: string | null;
  readonly orders: readonly OrderLine[];
  readonly activeAgent: AgentId;
  readonly messages: readonly AgentMessage[];
  readonly drawerOpen: boolean;
  /** Post-care drafts from the AI Receptionist (Sprint 10). Live when a
   * patient is routed in, mock otherwise. */
  readonly postCare: PostCarePackage | null;
  /** True while the post-care package is being drafted server-side. */
  readonly postCareLoading: boolean;
  /** Set when booking/dispatch handlers still have no backend behind them --
   * drives ReceptionistTab's "Pending integration" chip (audit M-2). */
  readonly postCarePendingIntegration: boolean;
  /** Re-run the post-care draft on demand. */
  refreshPostCare: () => Promise<void>;
  toggleRecording: () => void;
  updateSoap: (field: SoapField, value: string) => void;
  toggleChecklistItem: (id: string) => void;
  /** Remove a suggested checklist entry for this encounter (the deselect). */
  removeChecklistItem: (id: string) => void;
  /** Add the clinician's own row (see the implementation: never tagged as a suggestion). */
  addChecklistItem: (label: string) => void;
  /** Supporting transcript quote for an LLM-derived suggestion, if any. */
  checklistQuote: (id: string) => string | undefined;
  setActiveAgent: (agent: AgentId) => void;
  toggleDrawer: () => void;
  runAgentAction: (action: AgentAction) => void;
  /** Submit a prior-authorization for one order (Sprint 9). Resolves once the
   * transaction is queued; the payer outcome arrives over SSE and updates the
   * badge. Rejects if no real patient/encounter is wired into this shell. */
  submitPreAuth: (orderId: string) => Promise<void>;
}

// ---------------------------------------------------------------- mock data
const MOCK_TRANSCRIPT: readonly TranscriptLine[] = [
  { id: "t1", speaker: "clinician", text: "Good morning — what brings you in today?", at: "09:02" },
  { id: "t2", speaker: "patient", text: "I've had chest tightness when I climb stairs, for about two weeks.", at: "09:02" },
  { id: "t3", speaker: "clinician", text: "Any pain when you're resting?", at: "09:03" },
  { id: "t4", speaker: "patient", text: "No, only when I exert myself.", at: "09:03" },
  { id: "t5", speaker: "clinician", text: "Blood pressure is 148 over 92, heart rate 78, saturation 98 percent.", at: "09:05" },
  { id: "t6", speaker: "clinician", text: "Heart sounds are normal, no murmurs. Chest is clear.", at: "09:06" },
  { id: "t7", speaker: "clinician", text: "Let's get an ECG and review your lipid profile, then follow up in a week.", at: "09:08" },
];

/**
 * Which note the encounter shows, decided in one place.
 *
 * Extracted because choosing the source is what regressed: the rule was a line inside an effect, where
 * no test could see it, and it read `liveSoap ?? SOAP_STAGES[...]` -- so a single live call that
 * returned an empty note shadowed the staged note for the rest of the encounter, and the form sat
 * blank during demo playback while the transcript kept going. In demo mode the staged note wins,
 * unconditionally, however much live text has accumulated.
 */
export function resolveSoapBase(
  dictationMode: "live" | "demo",
  lineCount: number,
  liveSoap: SoapNote | null,
): SoapNote {
  const staged = SOAP_STAGES[Math.min(lineCount, SOAP_STAGES.length - 1)] ?? EMPTY_SOAP;
  return dictationMode === "demo" ? staged : (liveSoap ?? staged);
}

const EMPTY_SOAP: SoapNote = { subjective: "", objective: "", assessment: "", plan: "" };

/** SOAP text revealed progressively as the mock transcript streams in.
 * Deliberately carries no vital signs: those are recorded by the nurse before
 * the encounter and read from the patient record (see vitals.ts), so baking
 * numbers in here would put invented measurements in front of a clinician. */
const SOAP_STAGES: readonly SoapNote[] = [
  EMPTY_SOAP,
  { ...EMPTY_SOAP, subjective: "Chest tightness on exertion for two weeks." },
  { ...EMPTY_SOAP, subjective: "Chest tightness on exertion for two weeks. No pain at rest." },
  {
    subjective: "Chest tightness on exertion for two weeks. No pain at rest.",
    objective: "",
    assessment: "",
    plan: "",
  },
  {
    subjective: "Chest tightness on exertion for two weeks. No pain at rest.",
    objective: "Heart sounds normal, no murmurs. Chest clear.",
    assessment: "Known hypertension and type 2 diabetes.",
    plan: "",
  },
  {
    subjective: "Chest tightness on exertion for two weeks. No pain at rest.",
    objective: "Heart sounds normal, no murmurs. Chest clear.",
    assessment: "Known hypertension and type 2 diabetes.",
    plan: "ECG. Review lipid profile. Follow up in one week.",
  },
];

/** Checklist suggestion catalog — deterministic keyword matches over the
 * clinician's own words. An item is only ever suggested because the
 * clinician (or the SOAP drafted from their words) mentioned it — the
 * system recommends nothing beyond their own stated plan. */
/**
 * Trigger vocabulary. Each label is a task to carry out, never a clinical finding, and the
 * keywords are standard clinical wording a clinician would actually dictate or type.
 *
 * Kept deliberately in front of the matcher rather than behind an LLM: the decision to put a
 * row in front of a clinician has to be reproducible and auditable, and it must never propose
 * anything the clinician did not write down themselves.
 *
 * The first version listed one modality ("x-ray") and one lab phrase ("blood test"), so a plan
 * ordering "kidney ultrasound" or "urine culture" got no row at all. Widened to the modalities
 * and labs that appear in ordinary notes -- still explicit, still reviewable.
 */
const CHECKLIST_CATALOG: readonly { keywords: readonly string[]; id: string; label: string }[] = [
  { id: "c-vitals", keywords: ["vital signs", "blood pressure", "heart rate", "saturation"], label: "Record vital signs" },
  { id: "c-ecg", keywords: ["ecg", "electrocardiogram", "ekg"], label: "Order ECG" },
  { id: "c-lipid", keywords: ["lipid"], label: "Review lipid profile" },
  { id: "c-followup", keywords: ["follow up", "follow-up", "followup"], label: "Arrange follow-up" },
  { id: "c-labs", keywords: LAB_KEYWORDS, label: "Review lab results" },
  { id: "c-imaging", keywords: IMAGING_KEYWORDS, label: "Order imaging" },
  { id: "c-referral", keywords: ["referral", "refer to"], label: "Arrange referral" },
  { id: "c-meds", keywords: ["medication", "medications"], label: "Review medications" },
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Trigger match: whole words, with one inflection allowed.
 *
 * Substring matching was the source of two different failures. It let short abbreviations fire
 * inside unrelated words -- "alt" inside "salt" and "although" -- which is why the vocabulary
 * first had to exclude them, and it missed nothing else worth having. Requiring word boundaries
 * keeps "lipid" matching "lipids" and "ALT" matching only ALT.
 */
export function mentionsKeyword(haystack: string, keyword: string): boolean {
  // Compiled once per term. The vocabulary runs to hundreds of phrases and this is called for
  // every entry on every keystroke, so building the RegExp inline made each keystroke pay for
  // several hundred compilations.
  let re = KEYWORD_RE_CACHE.get(keyword);
  if (!re) {
    re = new RegExp(`\\b${escapeRe(keyword)}(?:s|es|ed|ing)?\\b`, "i");
    KEYWORD_RE_CACHE.set(keyword, re);
  }
  return re.test(haystack);
}

const KEYWORD_RE_CACHE = new Map<string, RegExp>();

/** Pure: derive suggested checklist entries from encounter text. */
export function proposeChecklist(
  transcriptText: string,
  soapText: string,
): readonly ChecklistItem[] {
  const haystack = `${transcriptText} ${soapText}`.toLowerCase();
  if (haystack.trim().length === 0) return [];
  const hits: ChecklistItem[] = [];
  for (const entry of CHECKLIST_CATALOG) {
    if (entry.keywords.some((k) => mentionsKeyword(haystack, k))) {
      hits.push({ id: entry.id, label: entry.label, done: false, proposed: true });
    }
  }
  return hits;
}

/** Pure: merge suggested entries into a checklist. Returns null when
 * nothing changed (lets React skip the re-render). Matches by label
 * (case-insensitive) so a suggestion about an existing row tags it
 * instead of duplicating; dismissed ids never return. */
export function mergeChecklistItems(
  prev: readonly ChecklistItem[],
  suggestions: readonly ChecklistItem[],
  dismissedIds: ReadonlySet<string>,
): readonly ChecklistItem[] | null {
  let changed = false;
  const next = [...prev];
  for (const sug of suggestions) {
    if (dismissedIds.has(sug.id)) continue;
    const byLabel = next.findIndex((item) => item.label.toLowerCase() === sug.label.toLowerCase());
    if (byLabel >= 0) {
      if (next[byLabel]!.proposed !== true) {
        next[byLabel] = { ...next[byLabel]!, proposed: true };
        changed = true;
      }
      continue;
    }
    next.push(sug);
    changed = true;
  }
  return changed ? next : null;
}

/**
 * Template rows. None of them ships ticked: three of these used to be `done: true` literals, so
 * the panel opened at "3/6" reporting documentation no clinician had written and -- because the
 * flag never depended on the encounter -- it did not move no matter what the note said. Rows now
 * start open and are ticked by evidence below.
 */
/**
 * Rows true of every encounter, whatever the complaint.
 *
 * This list used to carry a cardiac workup -- cardiovascular examination, ECG, lipid profile -- for
 * every patient, so a clinician documenting an abdominal complaint was shown three rows that could
 * never apply and had to dismiss them. A checklist that names the wrong organ is one nobody reads,
 * and dismissing rows that should never have been there costs exactly the time this is meant to save.
 *
 * Anything complaint-specific comes from proposeChecklist, which reads the note and the transcript.
 * The catalog already covers each row removed here, so nothing was lost: "ECG" reappears when the
 * note says ECG, and not before.
 */
const CHECKLIST_TEMPLATE: readonly ChecklistItem[] = [
  { id: "c1", label: "Document onset and duration", done: false },
  { id: "c2", label: "Record vital signs", done: false },
];

/**
 * What counts as evidence for each documentation row, and where it has to come from.
 *
 * `c2` is deliberately **not** a text match. Vitals in this system are entered by nursing as
 * observations and merged into the objective (see `mergeObjective`), so a sentence in the note
 * is not the same as a recorded vital sign and must not tick the row. A note claiming
 * "BP 114/82" with nothing in the record leaves this open -- which is the honest reading, and
 * the one a reviewer would take.
 */
const CHECKLIST_EVIDENCE: readonly {
  id: string;
  readonly why: string;
  readonly test: (note: string, hasVitals: boolean) => boolean;
}[] = [
  {
    id: "c1",
    why: "an onset or duration phrase in the note",
    test: (note) =>
      /\bonset\b/.test(note) ||
      /\b(for|since)\s+(\w+\s+){0,2}(hour|day|week|month|year)/.test(note),
  },
  {
    id: "c2",
    why: "nurse observations recorded on the encounter",
    test: (_note, hasVitals) => hasVitals,
  },
  {
    id: "c3",
    why: "a cardiovascular examination in the objective",
    test: (note) =>
      /\bheart sounds?\b|\bmurmurs?\b|\bjvp\b|\bapex beat\b|\bperipheral (pulse|pulses|edema|oedema)\b/.test(note),
  },
];

/** Pure: the documentation rows this encounter actually supports. */
export function deriveChecklistDone(noteText: string, hasVitals: boolean): ReadonlySet<string> {
  const note = noteText.toLowerCase();
  const earned = new Set<string>();
  for (const row of CHECKLIST_EVIDENCE) {
    if (row.test(note, hasVitals)) earned.add(row.id);
  }
  return earned;
}

/** Pure: apply earned ticks. A row the clinician toggled by hand is never overwritten. */
export function applyEarnedDone(
  items: readonly ChecklistItem[],
  earned: ReadonlySet<string>,
  touched: ReadonlySet<string>,
): readonly ChecklistItem[] {
  let changed = false;
  const next = items.map((item) => {
    if (touched.has(item.id)) return item;
    const done = earned.has(item.id);
    if (item.done === done) return item;
    changed = true;
    return { ...item, done };
  });
  return changed ? next : items;
}

const MOCK_TIMELINE: readonly TimelineEntry[] = [
  { id: "e1", kind: "encounter", title: "Cardiology clinic visit", detail: "Routine review — hypertension follow-up", at: "2026-07-18" },
  { id: "e2", kind: "lab", title: "HbA1c", detail: "7.8 % (ref 4.0–5.6)", at: "2026-07-18" },
  { id: "e3", kind: "lab", title: "Total cholesterol", detail: "5.9 mmol/L (ref <5.2)", at: "2026-07-18" },
  { id: "e4", kind: "medication", title: "Metformin 1000 mg", detail: "Oral, twice daily", at: "2026-07-02" },
  { id: "e5", kind: "note", title: "Progress note", detail: "Patient reports good adherence to medication.", at: "2026-06-28" },
  { id: "e6", kind: "imaging", title: "Chest X-ray", detail: "Reported: no acute cardiopulmonary abnormality", at: "2026-05-14" },
  { id: "e7", kind: "encounter", title: "Emergency department visit", detail: "Presented with palpitations, discharged same day", at: "2026-04-03" },
];

/** Evidence chains for the mock data (audit H-4).
 *
 * Before this, `evidenceChain` was only ever set inside the live
 * `useAgentOrchestrator` effects, so the "Show Reasoning" / "View Evidence
 * Chain" trigger rendered NOWHERE without a live NSCRE and a routed patientId
 * -- the product's central explainability feature was invisible in the demo
 * path most people see.
 *
 * These are shaped exactly like `build_evidence_chain()`'s real output
 * (services/veritas-graph/evidence_chain.py) so swapping them for live chains
 * changes nothing downstream. Each one is attached only where it is
 * CLINICALLY COHERENT for that row -- a renal-dose chain hanging off an
 * echocardiogram order would be visible nonsense to any clinician watching,
 * which is worse than showing no chain at all.
 */
const METFORMIN_RENAL_CHAIN: EvidenceChain = {
  steps: [
    { node_type: "Patient", properties: { MRN: "102" } },
    { node_type: "LabResult", properties: { eGFR: 28 } },
    { node_type: "Contraindication", properties: { medication: "Metformin", threshold: "eGFR < 30" } },
    { node_type: "Rule", properties: { flag: "CRITICAL_OVERRIDE" } },
  ],
  rendered:
    'Patient(MRN=102) -> LabResult(eGFR=28) -> Contraindication(Metformin, "eGFR < 30") -> Rule(CRITICAL_OVERRIDE)',
};

/** NPHIES necessity traversal behind the echocardiogram's pre-auth badge. */
const ECHO_PREAUTH_CHAIN: EvidenceChain = {
  steps: [
    { node_type: "Patient", properties: { MRN: "102" } },
    { node_type: "Condition", properties: { icd10: "I10", display: "Essential (primary) hypertension" } },
    { node_type: "NphiesService", properties: { sbs_code: "11712-00-10" } },
    { node_type: "NphiesRule", properties: { status: "YELLOW", pre_auth_required: true } },
  ],
  rendered:
    "Patient(MRN=102) -> Condition(icd10=I10) -> NphiesService(sbs_code=11712-00-10) -> NphiesRule(status=YELLOW, pre_auth_required=true)",
};

/** Why the angiography order has no necessity rule to stand on. */
const ANGIOGRAPHY_MISMATCH_CHAIN: EvidenceChain = {
  steps: [
    { node_type: "Patient", properties: { MRN: "102" } },
    { node_type: "Condition", properties: { icd10: "I25.1" } },
    { node_type: "NphiesService", properties: { sbs_code: "38306-00-99" } },
    { node_type: "NphiesRule", properties: { status: "RED", matched: false } },
  ],
  rendered:
    "Patient(MRN=102) -> Condition(icd10=I25.1) -> NphiesService(sbs_code=38306-00-99) -> NphiesRule(status=RED, matched=false)",
};

const MOCK_ORDERS: readonly OrderLine[] = [
  {
    id: "o1",
    category: "imaging",
    display: "Electrocardiogram (ECG), 12 lead",
    code: "11700-00-10",
    codeSystem: "SBS",
    nphiesStatus: "green",
    nphiesDetail: "Approved / covered — NPHIES code matched to documented diagnosis I10 (essential hypertension).",
  },
  {
    id: "o2",
    category: "lab",
    display: "Lipid profile",
    code: "66536-00-10",
    codeSystem: "SBS",
    nphiesStatus: "green",
    nphiesDetail: "Approved / covered — matched to documented diagnosis E78.0.",
  },
  {
    id: "o3",
    category: "imaging",
    display: "Echocardiogram, transthoracic",
    code: "11712-00-10",
    codeSystem: "SBS",
    nphiesStatus: "yellow",
    nphiesDetail: "Pre-authorisation required by the payer before this service can be claimed.",
    icd10Code: "I10",
    icd10Display: "Essential (primary) hypertension",
    evidenceChain: ECHO_PREAUTH_CHAIN,
  },
  {
    id: "o4",
    category: "medication",
    display: "Atorvastatin 20 mg",
    code: "C10AA05",
    codeSystem: "SFDA",
    nphiesStatus: "yellow",
    nphiesDetail: "Pre-authorisation required — formulary tier 2 medication.",
    icd10Code: "E78.0",
    icd10Display: "Pure hypercholesterolaemia",
  },
  {
    id: "o5",
    category: "procedure",
    display: "Coronary angiography",
    code: "38306-00-99",
    codeSystem: "SBS",
    nphiesStatus: "red",
    nphiesDetail:
      "Code mismatch — no recorded necessity rule links this procedure to the documented diagnoses. High rejection risk.",
    suggestedCodes: ["38300-00-10", "38306-00-10"],
    // Audit L-4: without a confirmed diagnosis code this order could never be
    // submitted once the red-badge path is wired to real coding.
    icd10Code: "I25.1",
    icd10Display: "Atherosclerotic heart disease of native coronary artery",
    evidenceChain: ANGIOGRAPHY_MISMATCH_CHAIN,
  },
];

/** Post-care package the AI Receptionist drafts once a discharge order is
 * finalised (Sprint 10). Mock, like the rest of this provider's data --
 * shaped exactly like services/orchestrator/receptionist_agent.py's output so
 * wiring it to the live endpoint is a swap, not a rewrite. */
const MOCK_POST_CARE: PostCarePackage = {
  followup_slots: [
    { starts_at: "2026-08-03T09:00:00Z", department: "Cardiology", appointment_type: "follow-up", status: "draft" },
    { starts_at: "2026-08-03T11:00:00Z", department: "Cardiology", appointment_type: "follow-up", status: "draft" },
    { starts_at: "2026-08-03T14:00:00Z", department: "Cardiology", appointment_type: "follow-up", status: "draft" },
  ],
  lab_prep_reminders: [
    {
      lab: "Lipid profile",
      instruction: "Do not eat or drink anything except water for 9-12 hours before this test.",
      source: "static_reference_table",
    },
  ],
  care_instructions: {
    text:
      "You were seen today for chest tightness on exertion. Your blood pressure was 148/92. " +
      "Please keep taking Atorvastatin 20 mg as prescribed, have your lipid profile done before " +
      "your next visit, and come back in one week.",
    requires_clinician_review: true,
  },
  dispatch_payloads: [
    {
      patient_id: "mock-patient",
      channel: "whatsapp",
      kind: "care_instructions",
      body:
        "You were seen today for chest tightness on exertion. Please keep taking Atorvastatin 20 mg " +
        "as prescribed and come back in one week.",
      status: "draft",
    },
    {
      patient_id: "mock-patient",
      channel: "sms",
      kind: "lab_prep",
      body: "Lipid profile: Do not eat or drink anything except water for 9-12 hours before this test.",
      status: "draft",
    },
  ],
};

const AGENT_ACTIONS: Record<AgentId, readonly AgentAction[]> = {
  scribe: [
    { id: "a-scribe-1", label: "Regenerate SOAP note", description: "Re-structure the current transcript into SOAP sections." },
    { id: "a-scribe-2", label: "Insert into chart", description: "Copy the finalised note into the encounter record.", pendingIntegration: true },
  ],
  consultant: [
    { id: "a-cons-1", label: "Summarise prior encounters", description: "Condense the last five visits into a short recap." },
    { id: "a-cons-2", label: "Show related results", description: "Pull the labs and imaging referenced in this note." },
  ],
  pharmacist: [
    { id: "a-pharm-1", label: "Adjust Dosage", description: "Open the dosage adjustment worksheet for the selected medication.", pendingIntegration: true },
    { id: "a-pharm-2", label: "Check formulary tier", description: "Look up payer formulary status for the current prescriptions.", pendingIntegration: true },
  ],
  nphies: [
    { id: "a-nph-1", label: "Submit Pre-Auth", description: "Send a pre-authorisation request for the yellow-flagged order lines." },
    { id: "a-nph-2", label: "Fix code mismatch", description: "Apply a suggested code to the red-flagged order line.", pendingIntegration: true },
  ],
  receptionist: [
    { id: "a-recep-1", label: "Book follow-up", description: "Schedule the one-week follow-up appointment.", pendingIntegration: true },
    { id: "a-recep-2", label: "Send visit summary", description: "Queue the patient-facing visit summary for sending.", pendingIntegration: true },
  ],
};

const INITIAL_MESSAGES: readonly AgentMessage[] = [
  { id: "m1", from: "scribe", text: "Draft SOAP note updated from the live transcript.", at: "09:06" },
  { id: "m2", from: "nphies", text: "2 order lines need pre-authorisation; 1 has a code mismatch.", at: "09:08" },
  { id: "m3", from: "pharmacist", text: "Atorvastatin is a tier 2 formulary item for this payer.", at: "09:09" },
  // Sprint 10: an inter-agent handoff chain, rendered distinctly from an
  // agent's own output. Mock, matching agent_bus.py's event shape.
  {
    id: "m4",
    from: "consultant",
    text: "Escalating a critical dose-safety finding on Metformin to Pharmacy.",
    at: "09:10",
    handoff: { sourceAgent: "consultant", targetAgent: "pharmacist", correlationId: "chain-1" },
    evidenceChain: METFORMIN_RENAL_CHAIN,
  },
  {
    id: "m5",
    from: "pharmacist",
    text: "1 candidate passed screening (no contraindication found). Not a substitution recommendation.",
    at: "09:10",
    handoff: { sourceAgent: "pharmacist", targetAgent: "nphies", correlationId: "chain-1" },
    evidenceChain: METFORMIN_RENAL_CHAIN,
  },
  {
    id: "m6",
    from: "nphies",
    text: "Coverage re-verified for the screened candidate.",
    at: "09:11",
    handoff: { sourceAgent: "nphies", targetAgent: "scribe", correlationId: "chain-1" },
  },
  {
    id: "m7",
    from: "scribe",
    text: "Drafted a Plan-section update for your review — not applied automatically.",
    at: "09:11",
    handoff: { sourceAgent: "scribe", targetAgent: "clinician", correlationId: "chain-1" },
    evidenceChain: METFORMIN_RENAL_CHAIN,
  },
];

export const AGENT_LABELS: Record<AgentId, string> = {
  scribe: "Scribe",
  consultant: "Consultant",
  pharmacist: "Pharmacist",
  nphies: "NPHIES / Billing",
  receptionist: "Receptionist",
};

export const AGENT_IDS: readonly AgentId[] = ["scribe", "consultant", "pharmacist", "nphies", "receptionist"];

export function agentActions(agent: AgentId): readonly AgentAction[] {
  return AGENT_ACTIONS[agent];
}

/** NSCRE necessity verdicts -> badge colours. Anything unrecognised maps to
 * nothing at all, so an unexpected value leaves the badge untouched instead of
 * defaulting to a colour the graph never asserted. */
const NSCRE_STATUS_TO_BADGE: Record<string, NphiesStatus | undefined> = {
  GREEN: "green",
  YELLOW: "yellow",
  RED: "red",
};

// -- S4.1 per-finding cutaway helpers -----------------------------------------
// Each assertion inside an agent result gets its own clickable evidence row.
// The label states what the finding IS (administrative restatement only --
// never an interpretation); the chain is the finding's own traversal, read
// verbatim from the result object, never shared or reconstructed.

function chainOf(value: unknown): EvidenceChain | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { steps?: unknown; rendered?: unknown };
  if (!Array.isArray(candidate.steps) || typeof candidate.rendered !== "string") return null;
  return value as EvidenceChain;
}

function propOf(f: Record<string, unknown>, key: string): string | null {
  const value = f[key];
  return typeof value === "string" ? value : null;
}

/** Human label for one raw NSCRE finding, by finding kind. Returns null when
 * the shape doesn't match -- the finding is then simply not offered as a
 * clickable row rather than guessed at. */
function findingLabel(kind: MessageFinding["kind"], f: Record<string, unknown>): string | null {
  if (kind === "ddi") {
    const a = propOf(f, "drug_a");
    const b = propOf(f, "drug_b");
    return a !== null && b !== null ? `DDI alert: ${a} × ${b}` : null;
  }
  if (kind === "dose") {
    const med = propOf(f, "medication");
    const egfr = f["egfr_value"];
    return med !== null && (typeof egfr === "number" || typeof egfr === "string")
      ? `Renal dose: ${med} (eGFR ${String(egfr)})`
      : null;
  }
  if (kind === "necessity") {
    const med = propOf(f, "medication");
    const status = propOf(f, "status");
    return med !== null && status !== null ? `Necessity: ${med} — ${status}` : null;
  }
  // screened
  const med = propOf(f, "medication");
  const result = propOf(f, "screen_result");
  return med !== null ? `Screened: ${med}${result !== null ? ` — ${result}` : ""}` : null;
}

function findingsFrom(
  list: readonly unknown[],
  kind: MessageFinding["kind"],
): readonly MessageFinding[] {
  const findings: MessageFinding[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const label = findingLabel(kind, record);
    const chain = chainOf(record["evidence_chain"]);
    if (label === null || chain === null) continue;
    findings.push({ kind, label, evidenceChain: chain });
  }
  return findings;
}

/** Maps agent_bus.py's agent names onto the drawer's tab ids. */
const AGENT_ID_BY_NAME: Record<string, AgentId> = {
  nscre: "consultant",
  consultant: "consultant",
  pharmacist: "pharmacist",
  nphies: "nphies",
  scribe: "scribe",
  clinician: "scribe",
};

/** One-line summary of a handoff hop for the activity stream.
 *
 * Deliberately describes only what the payload states -- counts and the
 * medication name -- and never re-words a clinical finding. Anything richer
 * belongs in the evidence chain, which is attached verbatim alongside. */
function describeHandoff(h: AgentHandoff): string {
  const p = h.payload as {
    finding?: { medication?: string; kind?: string };
    screened_candidates?: unknown[];
    coverage?: unknown[];
    draft_text?: string;
    error?: string;
  };
  switch (h.event_type) {
    case "nscre.critical_finding":
      return `Critical ${p.finding?.kind ?? "finding"} detected on ${p.finding?.medication ?? "a medication"}.`;
    case "consultant.escalation":
      return `Escalating a critical finding on ${p.finding?.medication ?? "a medication"} to Pharmacy.`;
    case "pharmacist.alternatives_screened": {
      const n = p.screened_candidates?.length ?? 0;
      return `${n} candidate${n === 1 ? "" : "s"} passed screening (no contraindication found). Not a substitution recommendation.`;
    }
    case "nphies.coverage_verified":
      return `Coverage re-verified for ${p.coverage?.length ?? 0} screened candidate(s).`;
    case "scribe.plan_updated":
      return p.draft_text
        ? `Drafted a Plan-section update for your review — not applied automatically.`
        : "Plan-section update drafted for review.";
    default:
      return p.error ? `Handoff failed: ${p.error}` : h.event_type;
  }
}

// ---------------------------------------------------------------- context
const CortexCtx = createContext<CortexState | null>(null);

/** Milliseconds between simulated transcript lines while "recording". */
const STREAM_INTERVAL_MS = 1800;

export function CortexProvider({
  children,
  autoStream = true,
  patientId = null,
  encounterId = null,
}: {
  readonly children: ReactNode;
  /** Disable the timer in tests/stories that drive state manually. */
  readonly autoStream?: boolean;
  /** Real patient to ground the AI Team agents in via NSCRE (Sprint 8).
   * Omitted/null keeps this shell in its existing demo/mock mode -- no page
   * in this app passes a real one yet (CortexShell has no patientId prop
   * either); wiring that into patient routing is a separate later step.
   * Live results only ever ADD to the mock activity stream below, never
   * replace it, so nothing here regresses when no patient is wired in. */
  readonly patientId?: string | null;
  /** Real encounter to submit pre-authorizations against (Sprint 9). Without
   * both this and patientId the shell stays in demo mode and the pre-auth modal
   * explains why submission is unavailable rather than silently failing. */
  readonly encounterId?: string | null;
}): JSX.Element {
  const [recording, setRecording] = useState(false);
  const [lineCount, setLineCount] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [soapOverride, setSoapOverride] = useState<Partial<SoapNote>>({});
  const [checklist, setChecklist] = useState<readonly ChecklistItem[]>(CHECKLIST_TEMPLATE);
  const dismissedChecklistIds = useRef<ReadonlySet<string>>(new Set());
  /** Mirrors `checklist` for callbacks that must read the current value (a toggle persists the value
   *  it just produced, and a state closure would read the render it was created in). */
  const checklistRef = useRef<readonly ChecklistItem[]>(CHECKLIST_TEMPLATE);
  const touchedChecklistIds = useRef<ReadonlySet<string>>(new Set());
  /** Supporting quotes for LLM-derived suggestions (tooltip provenance). */
  const checklistQuotes = useRef<ReadonlyMap<string, string>>(new Map());
  const [activeAgent, setActiveAgentState] = useState<AgentId>("scribe");
  // C02 (readiness assessment): synthetic and live datasets are mutually
  // exclusive. With a patient routed in, the stream starts empty and fills
  // only with real agent results; mock orders/messages/timeline appear only
  // in the offline demo (patientId == null), never as a fallback for a real
  // patient whose data is loading, empty, or failed.
  const [messages, setMessages] = useState<readonly AgentMessage[]>(
    patientId ? [] : INITIAL_MESSAGES,
  );
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [orders, setOrders] = useState<readonly OrderLine[]>(
    patientId ? [] : MOCK_ORDERS,
  );
  const messageSeq = useRef(0);

  const [dictationMode, setDictationMode] = useState<DictationMode>(patientId ? "live" : "demo");
  const [activeSpeaker, setActiveSpeakerState] = useState<"clinician" | "patient">("clinician");
  const activeSpeakerRef = useRef<"clinician" | "patient">("clinician");
  const [liveTranscript, setLiveTranscript] = useState<readonly TranscriptLine[]>([]);
  const [transcribing, setTranscribing] = useState(false);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const transcriptSeq = useRef(0);

  // Phase 2: the Sprint 10 agent bus and receptionist engine, now reachable
  // through core. Both stay null in demo mode -- there is no patient to run a
  // chain for, and inventing one would defeat the point.
  const [livePostCare, setLivePostCare] = useState<PostCarePackage | null>(null);
  const [postCareLoading, setPostCareLoading] = useState(false);
  const [liveHandoffs, setLiveHandoffs] = useState<readonly AgentHandoff[]>([]);
  const seenHandoffs = useRef<Set<string>>(new Set());
  const soapRef = useRef<SoapNote>(EMPTY_SOAP);
  const ordersRef = useRef<readonly OrderLine[]>(patientId ? [] : MOCK_ORDERS);

  // Live SOAP note from the orchestrator's DeepSeek formatting engine.
  // Null until the first successful generation. Stays null in demo mode.
  const [liveSoap, setLiveSoap] = useState<SoapNote | null>(null);
  // Vitals the nurse recorded before this encounter (audit C10 follow-up).
  const [nurseVitals, setNurseVitals] = useState<NurseVitals | null>(null);
  const [soapLoading, setSoapLoading] = useState(false);
  const [soapError, setSoapError] = useState<string | null>(null);

  // Session survival for live dictation: a page reload (dev HMR, refresh,
  // navigation) used to wipe an in-progress recording — the transcript was
  // pure in-memory state and unrecoverable. Mirror it to sessionStorage,
  // scoped to the patient and the browser tab's lifetime. Session scope
  // only (not localStorage): the recording stays on the clinician's own
  // workstation for the current tab session, matching the pane's
  // "nothing is written to the record from here" contract.
  const scribeKey = patientId ? `cortex.scribe.${patientId}` : null;

  // The nurse takes vitals before the patient sees the doctor. They are already
  // observations on the record, so the Objective section is filled from them --
  // read, never generated. A patient with no recorded vitals leaves Objective
  // to the clinician rather than receiving invented numbers.
  useEffect(() => {
    if (!patientId) {
      setNurseVitals(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const page = await api.patients.observations(patientId, {
          category: "vital-signs",
          limit: 50,
        });
        if (!cancelled) setNurseVitals(formatNurseVitals(page.data));
      } catch {
        // Vitals are a convenience: a record that cannot be read leaves the
        // section empty and the note still works.
        if (!cancelled) setNurseVitals(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  // Restore once per patient mount, before any new lines arrive.
  useEffect(() => {
    if (!scribeKey) return;
    try {
      const raw = sessionStorage.getItem(scribeKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { lines?: TranscriptLine[]; soap?: SoapNote | null };
      // The note is restored independently of the transcript: a clinician who
      // typed the SOAP without recording has no lines, and gating the note on
      // `lines.length > 0` silently discarded their work (audit C10/B4).
      if (Array.isArray(parsed.lines) && parsed.lines.length > 0) setLiveTranscript(parsed.lines);
      if (parsed.soap && typeof parsed.soap === "object") {
        setLiveSoap(parsed.soap);
        soapRef.current = parsed.soap;
      }
    } catch {
      // Corrupted cache -- start fresh rather than crash the encounter.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scribeKey]);

  // The sessionStorage mirror lives further down, after `soap`, so it can
  // persist the note the clinician actually reviewed -- see the C10 fix there.

  /** Draft the post-encounter package for the routed patient. */
  const refreshPostCare = useCallback(async () => {
    if (!patientId) return;
    setPostCareLoading(true);
    try {
      const result = await api.aiTeam.postCare(patientId, {
        // Derived from what the clinician has actually documented in this
        // encounter -- never a fabricated discharge order.
        ...(soapRef.current.assessment ? { diagnosis_display: soapRef.current.assessment } : {}),
        medications: ordersRef.current
          .filter((o) => o.category === "medication")
          .map((o) => ({ display: o.display })),
        labs: ordersRef.current.filter((o) => o.category === "lab").map((o) => ({ display: o.display })),
      });
      setLivePostCare(result);
    } catch {
      // Leave the previous package in place; the drawer keeps working.
    } finally {
      setPostCareLoading(false);
    }
  }, [patientId]);

  const appendTranscriptLine = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    transcriptSeq.current += 1;
    const speaker = activeSpeakerRef.current;
    setLiveTranscript((prev) => [
      ...prev,
      {
        id: `live-${transcriptSeq.current}`,
        // Speaker is set by the clinician's explicit toggle — the
        // transcription service has no diarization, and inferring who
        // spoke from content would risk clinical misattribution.
        speaker,
        text: trimmed,
        at: new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
  }, []);

  const { pharmacist, consultant, nphies } = useAgentOrchestrator(patientId);
  const { byOrder: nphiesByOrder, markQueued } = useNphiesStatus(patientId, encounterId);
  // Audit M-4: real observations/medications/encounters, mock only in demo mode.
  const {
    entries: liveTimeline,
    loading: timelineLoading,
    partialError: timelineError,
  } = usePatientTimeline(patientId);

  // Live agent results append to the activity stream as they arrive -- the
  // mock INITIAL_MESSAGES stay in place either way (see patientId's doc
  // comment above). Each hook result is a fresh object only when a new SSE
  // event actually lands, so these effects fire once per real update.
  useEffect(() => {
    if (!pharmacist) return;
    messageSeq.current += 1;
    const findings = [
      ...findingsFrom(pharmacist.findings.drug_interactions, "ddi"),
      ...findingsFrom(pharmacist.findings.dose_safety, "dose"),
    ];
    // C05: absence of findings is NOT evaluated safety — the defer signal
    // from the engine states why it held back (evidence gaps).
    const gapNote = pharmacist.overall_defer === true
      ? ` Evaluation deferred: ${pharmacist.evidence_gaps?.length ?? 0} evidence gap(s) — missing data, not a clean result.`
      : "";
    setMessages((prev) => [
      ...prev,
      {
        id: `m-live-pharmacist-${messageSeq.current}`,
        from: "pharmacist",
        text: pharmacist.prose || `No drug-interaction or dose-safety findings.${gapNote}`,
        at: "now",
        ...(pharmacist.evidence_chains[0] ? { evidenceChain: pharmacist.evidence_chains[0] } : {}),
        ...(findings.length > 0 ? { findings } : {}),
      },
    ]);
  }, [pharmacist]);

  useEffect(() => {
    if (!consultant) return;
    messageSeq.current += 1;
    const findings = [
      ...findingsFrom(consultant.findings.drug_interactions, "ddi"),
      ...findingsFrom(consultant.findings.dose_safety, "dose"),
      ...findingsFrom(consultant.findings.necessity, "necessity"),
    ];
    const gapNote = consultant.overall_defer === true
      ? ` Evaluation deferred: ${consultant.evidence_gaps?.length ?? 0} evidence gap(s) — missing data, not a clean result.`
      : "";
    setMessages((prev) => [
      ...prev,
      {
        id: `m-live-consultant-${messageSeq.current}`,
        from: "consultant",
        text: consultant.prose || `No additional clinical considerations.${gapNote}`,
        at: "now",
        ...(consultant.evidence_chains[0] ? { evidenceChain: consultant.evidence_chains[0] } : {}),
        ...(findings.length > 0 ? { findings } : {}),
      },
    ]);
  }, [consultant]);

  useEffect(() => {
    if (!nphies) return;
    messageSeq.current += 1;
    // Each NPHIES necessity card is its own clickable assertion — the chain is
    // the card's own traversal from the graph, never the message's first chain.
    const findings = findingsFrom(nphies.cards, "necessity");
    setMessages((prev) => [
      ...prev,
      {
        id: `m-live-nphies-${messageSeq.current}`,
        from: "nphies",
        text: nphies.prose || "No NPHIES necessity findings for current orders.",
        at: "now",
        ...(nphies.evidence_chains[0] ? { evidenceChain: nphies.evidence_chains[0] } : {}),
        ...(findings.length > 0 ? { findings } : {}),
      },
    ]);
  }, [nphies]);

  // Phase 2: NSCRE necessity findings drive the badges too.
  //
  // The NPHIES agent's cards come from deterministic graph queries
  // (services/veritas-graph, Module C) and arrive over the AI Team SSE stream.
  // They were previously rendered only as chat text, so a GREEN/YELLOW/RED
  // verdict the graph had already computed never reached the order it was
  // about. Matching is by medication name against the order display, and a
  // card that matches nothing is ignored rather than guessed onto an order.
  //
  // Payer outcomes (the effect below) are applied AFTER this one, so a real
  // NPHIES decision always wins over a graph prediction.
  useEffect(() => {
    const cards = nphies?.cards ?? [];
    if (cards.length === 0) return;
    setOrders((prev) =>
      prev.map((order) => {
        const card = cards.find(
          (c) =>
            c.medication &&
            order.display.toLowerCase().includes(c.medication.toLowerCase()),
        );
        if (!card) return order;
        // Never downgrade an order the payer has already ruled on.
        if (order.authorizationNumber || order.nphiesStatus === "blue") return order;
        const status = NSCRE_STATUS_TO_BADGE[card.status];
        if (!status) return order;
        return {
          ...order,
          nphiesStatus: status,
          nphiesDetail: card.pre_auth_required
            ? "Pre-authorisation required — NSCRE necessity rule matched with pre-auth flag."
            : "Necessity confirmed against the documented diagnosis by NSCRE.",
          ...(card.evidence_chain ? { evidenceChain: card.evidence_chain } : {}),
        };
      }),
    );
  }, [nphies]);

  // Apply live NPHIES badge transitions as payer outcomes arrive over SSE.
  // Only `approved` turns a badge green, and only with the authorization
  // reference the payer actually returned -- `pended` stays visibly undecided.
  useEffect(() => {
    if (Object.keys(nphiesByOrder).length === 0) return;
    setOrders((prev) =>
      prev.map((order) => {
        const event = nphiesByOrder[order.id];
        if (!event) return order;
        if (event.status === "queued") return { ...order, submitting: true };
        if (event.status === "approved") {
          return {
            ...order,
            submitting: false,
            nphiesStatus: "green",
            authorizationNumber: event.authorization_number ?? null,
            nphiesDetail:
              event.disposition ?? "Pre-authorisation approved by the payer.",
          };
        }
        if (event.status === "pended") {
          return {
            ...order,
            submitting: false,
            nphiesStatus: "blue",
            nphiesDetail:
              event.disposition ?? "Submitted — the payer has not returned a decision yet.",
          };
        }
        if (event.status === "error") {
          return {
            ...order,
            submitting: false,
            nphiesDetail: event.detail ?? "NPHIES submission failed.",
          };
        }
        return order;
      }),
    );
  }, [nphiesByOrder]);

  // Stream mock transcript lines while recording is active.
  useEffect(() => {
    if (!autoStream || !recording || dictationMode !== "demo") return;
    const timer = setInterval(() => {
      setLineCount((n) => (n >= MOCK_TRANSCRIPT.length ? n : n + 1));
      setElapsedSeconds((s) => s + STREAM_INTERVAL_MS / 1000);
    }, STREAM_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [recording, autoStream, dictationMode]);

  const transcript = useMemo(
    () => (dictationMode === "demo" ? MOCK_TRANSCRIPT.slice(0, lineCount) : liveTranscript),
    [dictationMode, lineCount, liveTranscript],
  );

  // Auto-generate live SOAP when transcript grows (debounced, live mode only).
  // Demo mode never calls this — the canned stages handle demo playback.
  // Speaker labels are included so the LLM can separate the patient's
  // subjective report from the clinician's objective findings — this is
  // the core S/O split the SOAP formatter depends on.
  const transcriptText = useMemo(
    () => transcript.map((l) => `${l.speaker}: ${l.text}`).join("\n"),
    [transcript],
  );

  // Smart checklist auto-proposal (Sully-style): entries the clinician
  // actually mentioned in dictation join the checklist automatically,
  // tagged as suggested. They arrive unchecked (tasks to complete);
  // removal dismisses them for the encounter. Matching an existing
  // template row marks that row suggested instead of duplicating it.
  // Two derivation layers, same merge:
  //   1. deterministic keyword matcher — always on, works offline;
  //   2. LLM extraction (live mode, ≥3 lines, debounced) — catches
  //      paraphrases the catalog misses. The orchestrator verifies each
  //      LLM item's supporting quote against the transcript before it
  //      reaches us, so only the clinician's own stated plans arrive.
  const mergeSuggestions = useCallback((suggestions: readonly ChecklistItem[], quotes?: ReadonlyMap<string, string>) => {
    if (suggestions.length === 0) return;
    setChecklist((prev) =>
      mergeChecklistItems(prev, suggestions, dismissedChecklistIds.current) ?? prev,
    );
    if (quotes && quotes.size > 0) {
      checklistQuotes.current = new Map([...checklistQuotes.current, ...quotes]);
    }
  }, []);

  // Re-propose whenever the encounter's text changes -- not only when the transcript grows.
  // This effect read `soapRef.current` while depending on `transcriptText` alone, so a note the
  // clinician typed or pasted straight into the SOAP fields never reached the matcher and the
  // checklist quietly stayed at its template rows: the feature looked dead in exactly the
  // workflow people use to test it. Both dictionaries are dependencies now, and the text comes
  // from the state they hold rather than from a ref that lags behind them.
  useEffect(() => {
    const soapText = [...Object.values(liveSoap ?? {}), ...Object.values(soapOverride)].join(" ");
    mergeSuggestions(proposeChecklist(transcriptText, soapText));
    const hasVitals =
      nurseVitals != null && Object.values(nurseVitals).some((v) => v != null && v !== "");
    const earned = deriveChecklistDone(`${transcriptText} ${soapText}`, hasVitals);
    setChecklist((prev) => applyEarnedDone(prev, earned, touchedChecklistIds.current));
  }, [transcriptText, liveSoap, soapOverride, nurseVitals, mergeSuggestions]);

  // LLM-assisted extraction (layer 2) — debounced like the SOAP generation
  // so both share the transcript-growth cadence.
  useEffect(() => {
    if (dictationMode !== "live" || !patientId || transcriptText.split("\n").length < 3) return;
    const timer = setTimeout(() => {
      api.aiTeam
        .extractChecklist(patientId, transcriptText)
        .then((r) => {
          const items = (r.items ?? []).map((item, i) => ({
            id: `llm-${i}-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`,
            label: item.label,
            done: false,
            proposed: true,
          }));
          const quotes = new Map((r.items ?? []).map((item, i) => {
            const id = items[i]!.id;
            return [id, item.supporting_quote] as const;
          }));
          mergeSuggestions(items, quotes);
        })
        .catch(() => {
          // Keyword layer already covers the catalog; LLM layer is additive.
        });
    }, 2_200);
    return () => clearTimeout(timer);
  }, [dictationMode, patientId, transcriptText, mergeSuggestions]);

  useEffect(() => {
    if (dictationMode !== "live" || !patientId || transcriptText.split("\n").length < 3) return;
    const timer = setTimeout(() => {
      setSoapLoading(true);
      setSoapError(null);
      api.aiTeam
        .generateSoap(patientId, transcriptText)
        .then((result) => {
          const note: SoapNote = {
            subjective: result.subjective ?? "",
            objective: result.objective ?? "",
            assessment: result.assessment ?? "",
            plan: result.plan ?? "",
          };
          setLiveSoap(note);
          soapRef.current = note;
        })
        .catch(() => {
          // Manual edits and the "Regenerate SOAP note" action still work;
          // the notice tells the clinician why the draft stopped updating
          // instead of failing silently (network drops were invisible).
          setSoapError(
            "Couldn't generate the SOAP note — the AI service was unreachable. Your transcript is safe; retry from the AI Team drawer (Regenerate SOAP).",
          );
        })
        .finally(() => setSoapLoading(false));
    }, 2_000);
    return () => clearTimeout(timer);
  }, [dictationMode, patientId, transcriptText]);

  // SOAP follows transcript progress, then any manual edits win.
  // In live mode, the DeepSeek-generated SOAP note replaces the canned stages.
  // In demo mode, the canned stages are preserved (no backend call).
  const soap = useMemo<SoapNote>(() => {
    // The mode decides which source is authoritative — liveSoap must NOT win in demo mode.
    //
    // It used to: `liveSoap ?? SOAP_STAGES[...]`, so a single live call poisoned the note for the rest
    // of the encounter. The generator is formatting-only, so a thin transcript returns a note whose
    // sections are empty — and in demo mode that empty note permanently shadowed the canned stages,
    // with the Objective still carrying the nurse's vitals. The screen looked like a playback that did
    // nothing, while the transcript filled normally behind it. Reported from testing, reproduced, and
    // this is the line that was wrong.
    const base = resolveSoapBase(dictationMode, lineCount, liveSoap);
    // Objective leads with the vitals the nurse recorded before the encounter.
    // They are read from the record, and the clinician's own edits still win
    // because soapOverride is applied last.
    const merged: SoapNote = { ...base, objective: mergeObjective(nurseVitals, base.objective) };
    return { ...merged, ...soapOverride };
  }, [dictationMode, liveSoap, lineCount, soapOverride, nurseVitals]);

  // Mirror the *effective* note on every change, so a reload and every later
  // journey stage see exactly what the clinician reviewed. Persisting only the
  // drafted text dropped every manual edit, and bailing out when there was no
  // transcript dropped a typed note entirely (audit C10/B4).
  useEffect(() => {
    if (!scribeKey) return;
    try {
      const hasNote = Boolean(
        soap.subjective.trim() || soap.objective.trim() || soap.assessment.trim() || soap.plan.trim(),
      );
      if (liveTranscript.length === 0 && !hasNote) return;
      sessionStorage.setItem(scribeKey, JSON.stringify({ lines: liveTranscript, soap }));
    } catch {
      // Storage full or blocked -- in-memory recording still works.
    }
  }, [scribeKey, liveTranscript, soap]);

  // Phase 2: run the handoff chain and re-draft post-care when the clinical
  // picture changes -- order set or the SOAP assessment. Debounced so typing
  // in the note does not fire a request per keystroke, and skipped entirely in
  // demo mode where there is no patient to reason about.
  const soapAssessment = soap.assessment;
  const orderSignature = useMemo(
    () => orders.map((o) => `${o.id}:${o.nphiesStatus}`).join("|"),
    [orders],
  );

  useEffect(() => {
    if (!patientId) return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { handoffs } = await api.aiTeam.runHandoffChain(patientId);
          if (handoffs.length === 0) return; // no critical finding: nothing to show
          setLiveHandoffs(handoffs);
        } catch {
          // A failed chain must not break the drawer; the mock stream stays.
        }
      })();
      void refreshPostCare();
    }, 800);
    return () => clearTimeout(timer);
  }, [patientId, orderSignature, soapAssessment, refreshPostCare]);

  // Render each new handoff hop as an activity-stream message. Deduplicated by
  // correlation id + sequence so a re-run of the same chain does not duplicate
  // the conversation.
  useEffect(() => {
    if (liveHandoffs.length === 0) return;
    const fresh = liveHandoffs.filter(
      (h) => !seenHandoffs.current.has(`${h.correlation_id}:${h.sequence}`),
    );
    if (fresh.length === 0) return;
    for (const h of fresh) seenHandoffs.current.add(`${h.correlation_id}:${h.sequence}`);

    setMessages((prev) => [
      ...prev,
      ...fresh.map((h) => {
        messageSeq.current += 1;
        const chain = (h.payload as { evidence_chain?: EvidenceChain }).evidence_chain;
        // Alternative-medication screening hops carry the graph's per-candidate
        // results; surface each screened candidate as its own clickable row.
        const screened = (h.payload as { screened_candidates?: readonly unknown[] }).screened_candidates;
        const findings = Array.isArray(screened) ? findingsFrom(screened, "screened") : [];
        return {
          id: `m-handoff-${h.correlation_id}-${h.sequence}`,
          from: AGENT_ID_BY_NAME[h.source_agent] ?? "consultant",
          text: describeHandoff(h),
          at: "now",
          handoff: {
            sourceAgent: h.source_agent,
            targetAgent: h.target_agent,
            correlationId: h.correlation_id,
          },
          ...(chain ? { evidenceChain: chain } : {}),
          ...(findings.length > 0 ? { findings } : {}),
        } satisfies AgentMessage;
      }),
    ]);
  }, [liveHandoffs]);

  useEffect(() => {
    soapRef.current = soap;
  }, [soap]);
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  const submitPreAuth = useCallback(
    async (orderId: string) => {
      const order = orders.find((o) => o.id === orderId);
      if (!order) throw new Error("Unknown order.");
      if (!patientId || !encounterId) {
        // Refuse rather than fake it: with no real patient/encounter there is
        // nothing to send, and a simulated "approval" would be a fabricated
        // payer decision.
        throw new Error(
          "This shell is running in demo mode with no patient encounter wired in, so there is nothing to submit to NPHIES.",
        );
      }
      if (!order.icd10Code) {
        throw new Error("This order has no confirmed ICD-10-AM diagnosis code to justify it.");
      }
      markQueued(orderId);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, submitting: true } : o)));
      try {
        await api.patients.submitPreAuth(patientId, {
          encounter_id: encounterId,
          order_id: orderId,
          icd10_code: order.icd10Code,
          sbs_code: order.code,
          clinical_document: `${soap.subjective}\n\n${soap.objective}\n\n${soap.assessment}\n\n${soap.plan}`.trim(),
          ...(order.icd10Display ? { icd10_display: order.icd10Display } : {}),
          sbs_display: order.display,
        });
      } catch (err) {
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, submitting: false } : o)));
        throw err;
      }
    },
    [orders, patientId, encounterId, markQueued, soap],
  );

  const toggleRecording = useCallback(() => setRecording((r) => !r), []);

  const updateSoap = useCallback((field: SoapField, value: string) => {
    setSoapOverride((prev) => ({ ...prev, [field]: value }));
  }, []);

  const checklistQuote = useCallback(
    (id: string): string | undefined => checklistQuotes.current.get(id),
    [],
  );

  // Persist a decision. Only decisions are stored: entries and the ticks that follow from the note
  // are derived, so persisting them would create a second source of truth that could disagree with
  // the note. A lost write must not break the encounter — the clinician can simply repeat it.
  const persistChecklistDecision = useCallback(
    (itemId: string, state: "done" | "dismissed" | null, label?: string | null) => {
      if (!patientId || !encounterId) return;
      void api.patients.setChecklistDecision(patientId, encounterId, itemId, state, label).catch(() => {
        /* the checklist keeps working in memory */
      });
    },
    [patientId, encounterId],
  );

  useEffect(() => {
    checklistRef.current = checklist;
  }, [checklist]);

  // The clinician's decisions come back with the encounter. Dismissals used to live in a ref, so a
  // refresh handed the same suggestion back — and a dismissal made at one visit came back at the
  // next, where it may not apply at all.
  useEffect(() => {
    if (!patientId || !encounterId) return;
    let live = true;
    void api.patients
      .checklistDecisions(patientId, encounterId)
      .then((r) => {
        if (!live) return;
        const dismissed = new Set(r.data.filter((d) => d.state === "dismissed").map((d) => d.item_id));
        const doneIds = new Set(r.data.filter((d) => d.state === "done").map((d) => d.item_id));
        dismissedChecklistIds.current = new Set([...dismissedChecklistIds.current, ...dismissed]);
        touchedChecklistIds.current = new Set([...touchedChecklistIds.current, ...doneIds]);
        setChecklist((prev) => {
          const next = prev
            .filter((i) => !dismissed.has(i.id))
            .map((i) => (doneIds.has(i.id) ? { ...i, done: true } : i));
          // A row the clinician typed lives in no catalog, so it exists only if the record says so:
          // its text comes back with the decision, and without this the item they added is gone the
          // next time the page loads -- the one thing adding it was meant to prevent.
          for (const d of r.data) {
            if (d.label && !next.some((i) => i.id === d.item_id)) {
              next.push({ id: d.item_id, label: d.label, done: d.state === "done" });
            }
          }
          return next;
        });
      })
      .catch(() => {
        /* the checklist still works in memory; the decisions simply do not return */
      });
    return () => {
      live = false;
    };
  }, [patientId, encounterId]);

  /** The clinician's OWN checklist row, typed by them.
   *
   *  Stored with `proposed: false` on purpose: this is the clinician's assertion, not a system
   *  suggestion, so it must not wear the "recommended" tag or the quote-from-dictation tooltip. The
   *  system never invents a row here -- it only keeps the one the clinician asked for. */
  const addChecklistItem = useCallback((label: string) => {
    const text = label.trim();
    if (!text) return;
    setChecklist((prev) => {
      // A row the clinician already has, however it got there, is not duplicated.
      if (prev.some((i) => i.label.trim().toLowerCase() === text.toLowerCase())) return prev;
      const item = { id: `phys-${Date.now().toString(36)}`, label: text, done: false };
      // Persist with the text: the id alone means nothing to anyone reading the row back, so without
      // this the clinician's own item is gone the next time the page loads.
      if (patientId && encounterId) {
        void api.patients
          .setChecklistDecision(patientId, encounterId, item.id, "done", text)
          .catch(() => { /* the row stays for this encounter; the next load will not find it */ });
      }
      return [...prev, item];
    });
  }, [patientId, encounterId]);

  const removeChecklistItem = useCallback(
    (id: string) => {
      dismissedChecklistIds.current = new Set([...dismissedChecklistIds.current, id]);
      setChecklist((prev) => prev.filter((item) => item.id !== id));
      persistChecklistDecision(id, "dismissed");
    },
    [persistChecklistDecision],
  );

  const toggleChecklistItem = useCallback((id: string) => {
    // Remember the manual toggle. Derivation runs again on every note change, and without this
    // a clinician who ticked a row by hand would watch it revert on their next keystroke.
    touchedChecklistIds.current = new Set([...touchedChecklistIds.current, id]);
    setChecklist((items) =>
      items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)),
    );
    const next = !(checklistRef.current?.find((i) => i.id === id)?.done ?? false);
    // A tick is a decision worth keeping. Un-ticking clears the stored decision instead of storing a
    // negative one, so a row only ever means "the clinician decided this" — but that also means an
    // un-tick does not survive a reload when the derivation would have ticked the row. A third state
    // is the fix if that proves annoying; it is recorded rather than guessed at now.
    persistChecklistDecision(id, next ? "done" : null);
  }, [persistChecklistDecision]);

  const setActiveAgent = useCallback((agent: AgentId) => setActiveAgentState(agent), []);

  const setActiveSpeaker = useCallback((speaker: "clinician" | "patient") => {
    activeSpeakerRef.current = speaker;
    setActiveSpeakerState(speaker);
  }, []);
  const toggleDrawer = useCallback(() => setDrawerOpen((o) => !o), []);

  const runAgentAction = useCallback(
    (action: AgentAction) => {
      if (action.pendingIntegration) return;

      const addMessage = (text: string) => {
        messageSeq.current += 1;
        setMessages((prev) => [
          ...prev,
          { id: `m-run-${messageSeq.current}`, from: activeAgent, text, at: "now" },
        ]);
      };

      switch (action.id) {
        case "a-scribe-1": {
          // Regenerate SOAP note via the orchestrator.
          if (!patientId) {
            addMessage("SOAP regeneration requires a live patient context.");
            return;
          }
          setSoapLoading(true);
          addMessage("Regenerating SOAP note…");
          const text = transcript.map((l) => `${l.speaker}: ${l.text}`).join("\n");
          api.aiTeam
            .generateSoap(patientId, text)
            .then((result) => {
              const note: SoapNote = {
                subjective: result.subjective ?? "",
                objective: result.objective ?? "",
                assessment: result.assessment ?? "",
                plan: result.plan ?? "",
              };
              setLiveSoap(note);
              soapRef.current = note;
              addMessage("SOAP note regenerated successfully.");
            })
            .catch(() => addMessage("SOAP regeneration failed — the orchestrator may be unavailable."))
            .finally(() => setSoapLoading(false));
          break;
        }

        case "a-cons-1": {
          // Summarise prior encounters — calls the narrative endpoint.
          if (!patientId) {
            addMessage("Narrative summary requires a live patient context.");
            return;
          }
          addMessage("Generating encounter summary…");
          api.narrative
            .generate(patientId, { language: "en", scope: "encounter" })
            .then((item) => {
              addMessage(item.text ?? item.fallback_message ?? "No summary available.");
            })
            .catch(() => addMessage("Failed to generate summary."));
          break;
        }

        case "a-cons-2": {
          // Show related results — calls observations endpoint.
          if (!patientId) {
            addMessage("Results lookup requires a live patient context.");
            return;
          }
          addMessage("Fetching related results…");
          api.patients
            .observations(patientId, { limit: 10 })
            .then((res) => {
              addMessage(`${res.total} observation(s) found for this patient.`);
            })
            .catch(() => addMessage("Failed to fetch observations."));
          break;
        }

        case "a-nph-1": {
          // Submit Pre-Auth — delegates to the existing submitPreAuth flow.
          const yellowOrder = orders.find((o) => o.nphiesStatus === "yellow");
          if (!yellowOrder) {
            addMessage("No yellow-flagged order lines to submit for pre-authorisation.");
            return;
          }
          submitPreAuth(yellowOrder.id)
            .then(() => addMessage(`Pre-auth submitted for ${yellowOrder.display}.`))
            .catch((err) => addMessage(`Pre-auth failed: ${err instanceof Error ? err.message : "unknown error"}`));
          break;
        }

        default:
          addMessage("Pending integration — no backend connected.");
      }
    },
    [activeAgent, patientId, transcript, orders, submitPreAuth],
  );

  const value = useMemo<CortexState>(
    () => ({
      encounterId,
      recording,
      elapsedSeconds,
      transcript,
      soap,
      nurseVitals,
      soapError,
      soapLoading,
      checklist,
      // C02: with a patient routed in, the timeline IS the live data --
      // empty while loading, honestly empty when the record has none.
      // MOCK_TIMELINE renders only in the offline demo (no patientId).
      timeline: patientId ? liveTimeline : MOCK_TIMELINE,
      timelineLoading,
      timelineError,
      orders,
      activeAgent,
      messages,
      drawerOpen,
      // Live package when a patient is routed in; the mock keeps the offline
      // demo intact (audit H-4/M-3 posture).
      postCare: patientId ? livePostCare : MOCK_POST_CARE,
      postCareLoading,
      // Booking/dispatch still have no backend behind them (audit M-2).
      postCarePendingIntegration: true,
      refreshPostCare,
      dictationMode,
      patientId: patientId ?? null,
      transcribing,
      dictationError,
      setDictationMode,
      appendTranscriptLine,
      activeSpeaker,
      setActiveSpeaker,
      setTranscribing,
      setDictationError,
      toggleRecording,
      updateSoap,
      toggleChecklistItem,
      removeChecklistItem,
      addChecklistItem,
      checklistQuote,
      setActiveAgent,
      toggleDrawer,
      runAgentAction,
      submitPreAuth,
    }),
    [
      recording, elapsedSeconds, transcript, soap, checklist, orders, activeAgent,
      messages, drawerOpen, toggleRecording, updateSoap, toggleChecklistItem,
      setActiveAgent, toggleDrawer, runAgentAction, submitPreAuth,
      dictationMode, patientId, transcribing, dictationError, appendTranscriptLine,
      livePostCare, postCareLoading, refreshPostCare,
      liveTimeline, timelineLoading, timelineError,
    ],
  );

  return <CortexCtx.Provider value={value}>{children}</CortexCtx.Provider>;
}

export function useCortex(): CortexState {
  const ctx = useContext(CortexCtx);
  if (!ctx) throw new Error("useCortex must be used inside a CortexProvider");
  return ctx;
}
