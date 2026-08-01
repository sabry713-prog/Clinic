/**
 * SullyContext — mock state for the 3-pane clinical shell (Sprint 3).
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
import type { PostCarePackage } from "../ai-team/ReceptionistTab";
import type { AgentHandoff } from "../../lib/api";

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

interface SullyState {
  readonly recording: boolean;
  readonly elapsedSeconds: number;
  readonly transcript: readonly TranscriptLine[];
  /** Which capture path the scribe pane is using. */
  readonly dictationMode: DictationMode;
  /** Null in demo mode -- real dictation needs a patient to post audio against. */
  readonly patientId: string | null;
  /** True while audio is being transcribed server-side. */
  readonly transcribing: boolean;
  /** Surfaces mic/transcription failures instead of failing silently. */
  readonly dictationError: string | null;
  setDictationMode: (mode: DictationMode) => void;
  /** Append a real transcribed utterance to the live transcript. */
  appendTranscriptLine: (text: string) => void;
  setTranscribing: (value: boolean) => void;
  setDictationError: (message: string | null) => void;
  readonly soap: SoapNote;
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

const EMPTY_SOAP: SoapNote = { subjective: "", objective: "", assessment: "", plan: "" };

/** SOAP text revealed progressively as the mock transcript streams in. */
const SOAP_STAGES: readonly SoapNote[] = [
  EMPTY_SOAP,
  { ...EMPTY_SOAP, subjective: "Chest tightness on exertion for two weeks." },
  { ...EMPTY_SOAP, subjective: "Chest tightness on exertion for two weeks. No pain at rest." },
  {
    subjective: "Chest tightness on exertion for two weeks. No pain at rest.",
    objective: "BP 148/92, HR 78, SpO2 98%.",
    assessment: "",
    plan: "",
  },
  {
    subjective: "Chest tightness on exertion for two weeks. No pain at rest.",
    objective: "BP 148/92, HR 78, SpO2 98%. Heart sounds normal, no murmurs. Chest clear.",
    assessment: "Known hypertension and type 2 diabetes.",
    plan: "",
  },
  {
    subjective: "Chest tightness on exertion for two weeks. No pain at rest.",
    objective: "BP 148/92, HR 78, SpO2 98%. Heart sounds normal, no murmurs. Chest clear.",
    assessment: "Known hypertension and type 2 diabetes.",
    plan: "ECG. Review lipid profile. Follow up in one week.",
  },
];

const MOCK_CHECKLIST: readonly ChecklistItem[] = [
  { id: "c1", label: "Document onset and duration", done: true },
  { id: "c2", label: "Record vital signs", done: true },
  { id: "c3", label: "Cardiovascular examination", done: true },
  { id: "c4", label: "Order ECG", done: false },
  { id: "c5", label: "Review lipid profile", done: false },
  { id: "c6", label: "Arrange follow-up", done: false },
];

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
    { id: "a-scribe-2", label: "Insert into chart", description: "Copy the finalised note into the encounter record." },
  ],
  consultant: [
    { id: "a-cons-1", label: "Summarise prior encounters", description: "Condense the last five visits into a short recap." },
    { id: "a-cons-2", label: "Show related results", description: "Pull the labs and imaging referenced in this note." },
  ],
  pharmacist: [
    { id: "a-pharm-1", label: "Adjust Dosage", description: "Open the dosage adjustment worksheet for the selected medication." },
    { id: "a-pharm-2", label: "Check formulary tier", description: "Look up payer formulary status for the current prescriptions." },
  ],
  nphies: [
    { id: "a-nph-1", label: "Submit Pre-Auth", description: "Send a pre-authorisation request for the yellow-flagged order lines." },
    { id: "a-nph-2", label: "Fix code mismatch", description: "Apply a suggested code to the red-flagged order line." },
  ],
  receptionist: [
    { id: "a-recep-1", label: "Book follow-up", description: "Schedule the one-week follow-up appointment." },
    { id: "a-recep-2", label: "Send visit summary", description: "Queue the patient-facing visit summary for sending." },
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
const SullyCtx = createContext<SullyState | null>(null);

/** Milliseconds between simulated transcript lines while "recording". */
const STREAM_INTERVAL_MS = 1800;

export function SullyProvider({
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
   * in this app passes a real one yet (SullyShell has no patientId prop
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
  const [checklist, setChecklist] = useState<readonly ChecklistItem[]>(MOCK_CHECKLIST);
  const [activeAgent, setActiveAgentState] = useState<AgentId>("scribe");
  const [messages, setMessages] = useState<readonly AgentMessage[]>(INITIAL_MESSAGES);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [orders, setOrders] = useState<readonly OrderLine[]>(MOCK_ORDERS);
  const messageSeq = useRef(0);

  // Audit H-3: real dictation when a patient is routed in, canned playback
  // otherwise. Defaulting to `demo` without a patientId keeps the offline
  // demo working exactly as before rather than showing a mic that cannot work.
  const [dictationMode, setDictationMode] = useState<DictationMode>(patientId ? "live" : "demo");
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
  const ordersRef = useRef<readonly OrderLine[]>(MOCK_ORDERS);

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
    setLiveTranscript((prev) => [
      ...prev,
      {
        id: `live-${transcriptSeq.current}`,
        // The transcription service returns one utterance without speaker
        // attribution -- labelling it "clinician" would be an invented fact,
        // so dictated lines are attributed to the person holding the mic only
        // because that is who pressed record.
        speaker: "clinician",
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
    setMessages((prev) => [
      ...prev,
      {
        id: `m-live-pharmacist-${messageSeq.current}`,
        from: "pharmacist",
        text: pharmacist.prose || "No drug-interaction or dose-safety findings.",
        at: "now",
        ...(pharmacist.evidence_chains[0] ? { evidenceChain: pharmacist.evidence_chains[0] } : {}),
      },
    ]);
  }, [pharmacist]);

  useEffect(() => {
    if (!consultant) return;
    messageSeq.current += 1;
    setMessages((prev) => [
      ...prev,
      {
        id: `m-live-consultant-${messageSeq.current}`,
        from: "consultant",
        text: consultant.prose || "No additional clinical considerations.",
        at: "now",
        ...(consultant.evidence_chains[0] ? { evidenceChain: consultant.evidence_chains[0] } : {}),
      },
    ]);
  }, [consultant]);

  useEffect(() => {
    if (!nphies) return;
    messageSeq.current += 1;
    setMessages((prev) => [
      ...prev,
      {
        id: `m-live-nphies-${messageSeq.current}`,
        from: "nphies",
        text: nphies.prose || "No NPHIES necessity findings for current orders.",
        at: "now",
        ...(nphies.evidence_chains[0] ? { evidenceChain: nphies.evidence_chains[0] } : {}),
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

  // SOAP follows transcript progress, then any manual edits win.
  const soap = useMemo<SoapNote>(() => {
    const stage = SOAP_STAGES[Math.min(lineCount, SOAP_STAGES.length - 1)] ?? EMPTY_SOAP;
    return { ...stage, ...soapOverride };
  }, [lineCount, soapOverride]);

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

  const toggleChecklistItem = useCallback((id: string) => {
    setChecklist((items) =>
      items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)),
    );
  }, []);

  const setActiveAgent = useCallback((agent: AgentId) => setActiveAgentState(agent), []);
  const toggleDrawer = useCallback(() => setDrawerOpen((o) => !o), []);

  const runAgentAction = useCallback(
    (action: AgentAction) => {
      messageSeq.current += 1;
      setMessages((prev) => [
        ...prev,
        {
          id: `m-run-${messageSeq.current}`,
          from: activeAgent,
          text: `${action.label} — requested.`,
          at: "now",
        },
      ]);
    },
    [activeAgent],
  );

  const value = useMemo<SullyState>(
    () => ({
      recording,
      elapsedSeconds,
      transcript,
      soap,
      checklist,
      timeline: patientId && liveTimeline.length > 0 ? liveTimeline : MOCK_TIMELINE,
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
      setTranscribing,
      setDictationError,
      toggleRecording,
      updateSoap,
      toggleChecklistItem,
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

  return <SullyCtx.Provider value={value}>{children}</SullyCtx.Provider>;
}

export function useSully(): SullyState {
  const ctx = useContext(SullyCtx);
  if (!ctx) throw new Error("useSully must be used inside a SullyProvider");
  return ctx;
}
