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

// ---------------------------------------------------------------- types
export type NphiesStatus = "green" | "yellow" | "red";

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
}

interface SullyState {
  readonly recording: boolean;
  readonly elapsedSeconds: number;
  readonly transcript: readonly TranscriptLine[];
  readonly soap: SoapNote;
  readonly checklist: readonly ChecklistItem[];
  readonly timeline: readonly TimelineEntry[];
  readonly orders: readonly OrderLine[];
  readonly activeAgent: AgentId;
  readonly messages: readonly AgentMessage[];
  readonly drawerOpen: boolean;
  toggleRecording: () => void;
  updateSoap: (field: SoapField, value: string) => void;
  toggleChecklistItem: (id: string) => void;
  setActiveAgent: (agent: AgentId) => void;
  toggleDrawer: () => void;
  runAgentAction: (action: AgentAction) => void;
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
  },
  {
    id: "o4",
    category: "medication",
    display: "Atorvastatin 20 mg",
    code: "C10AA05",
    codeSystem: "SFDA",
    nphiesStatus: "yellow",
    nphiesDetail: "Pre-authorisation required — formulary tier 2 medication.",
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
  },
];

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

// ---------------------------------------------------------------- context
const SullyCtx = createContext<SullyState | null>(null);

/** Milliseconds between simulated transcript lines while "recording". */
const STREAM_INTERVAL_MS = 1800;

export function SullyProvider({
  children,
  autoStream = true,
}: {
  readonly children: ReactNode;
  /** Disable the timer in tests/stories that drive state manually. */
  readonly autoStream?: boolean;
}): JSX.Element {
  const [recording, setRecording] = useState(false);
  const [lineCount, setLineCount] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [soapOverride, setSoapOverride] = useState<Partial<SoapNote>>({});
  const [checklist, setChecklist] = useState<readonly ChecklistItem[]>(MOCK_CHECKLIST);
  const [activeAgent, setActiveAgentState] = useState<AgentId>("scribe");
  const [messages, setMessages] = useState<readonly AgentMessage[]>(INITIAL_MESSAGES);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const messageSeq = useRef(0);

  // Stream mock transcript lines while recording is active.
  useEffect(() => {
    if (!autoStream || !recording) return;
    const timer = setInterval(() => {
      setLineCount((n) => (n >= MOCK_TRANSCRIPT.length ? n : n + 1));
      setElapsedSeconds((s) => s + STREAM_INTERVAL_MS / 1000);
    }, STREAM_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [recording, autoStream]);

  const transcript = useMemo(() => MOCK_TRANSCRIPT.slice(0, lineCount), [lineCount]);

  // SOAP follows transcript progress, then any manual edits win.
  const soap = useMemo<SoapNote>(() => {
    const stage = SOAP_STAGES[Math.min(lineCount, SOAP_STAGES.length - 1)] ?? EMPTY_SOAP;
    return { ...stage, ...soapOverride };
  }, [lineCount, soapOverride]);

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
      timeline: MOCK_TIMELINE,
      orders: MOCK_ORDERS,
      activeAgent,
      messages,
      drawerOpen,
      toggleRecording,
      updateSoap,
      toggleChecklistItem,
      setActiveAgent,
      toggleDrawer,
      runAgentAction,
    }),
    [
      recording, elapsedSeconds, transcript, soap, checklist, activeAgent,
      messages, drawerOpen, toggleRecording, updateSoap, toggleChecklistItem,
      setActiveAgent, toggleDrawer, runAgentAction,
    ],
  );

  return <SullyCtx.Provider value={value}>{children}</SullyCtx.Provider>;
}

export function useSully(): SullyState {
  const ctx = useContext(SullyCtx);
  if (!ctx) throw new Error("useSully must be used inside a SullyProvider");
  return ctx;
}
