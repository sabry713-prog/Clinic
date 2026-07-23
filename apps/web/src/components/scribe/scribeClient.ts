/**
 * Client for the orchestrator's live-scribe endpoints.
 *
 * Only recognised TEXT is sent — audio stays in the browser. The orchestrator
 * applies the PHI egress guard before any of it reaches an external model, so
 * a 403 here means policy blocked the call, not that something broke.
 */

export interface SoapNote {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

export interface ChecklistItem {
  readonly symptom: string;
  readonly label: string;
  done: boolean;
}

export interface StructureResult {
  readonly soap: SoapNote;
  /** Sections that changed on this pass — used to flash the highlight. */
  readonly changed: readonly (keyof SoapNote)[];
  readonly checklist: readonly ChecklistItem[];
}

export const EMPTY_SOAP: SoapNote = {
  subjective: "",
  objective: "",
  assessment: "",
  plan: "",
};

const BASE =
  (import.meta.env["VITE_ORCHESTRATOR_URL"] as string | undefined) ??
  "http://localhost:5010";

export class ScribeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** true when the PHI egress policy refused the call */
    readonly blockedByPolicy: boolean,
  ) {
    super(message);
    this.name = "ScribeError";
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = (await res.json()) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch { /* non-JSON error body */ }
    throw new ScribeError(detail, res.status, res.status === 403);
  }
  return (await res.json()) as T;
}

export async function openSession(patientNames: readonly string[] = []): Promise<string> {
  const r = await post<{ session_id: string }>("/scribe/sessions", {
    patient_names: patientNames,
  });
  return r.session_id;
}

export async function pushChunk(sessionId: string, text: string): Promise<StructureResult> {
  return post<StructureResult>(`/scribe/sessions/${sessionId}/chunks`, { text });
}

export async function structureTranscript(
  transcript: string,
  patientNames: readonly string[] = [],
): Promise<StructureResult> {
  return post<StructureResult>("/scribe/structure", {
    transcript,
    patient_names: patientNames,
  });
}

/**
 * Deterministic symptom -> documentation checks. No model call, so this keeps
 * working even when the egress policy blocks the structuring step.
 */
export async function fetchChecklist(transcript: string): Promise<readonly ChecklistItem[]> {
  const res = await fetch(
    `${BASE}/scribe/checklist?transcript=${encodeURIComponent(transcript)}`,
  );
  if (!res.ok) return [];
  const j = (await res.json()) as { items: ChecklistItem[] };
  return j.items ?? [];
}

export async function isOrchestratorUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Subscribe to the SSE stream for a session.
 * Returns an unsubscribe function.
 */
export function subscribeToSession(
  sessionId: string,
  handlers: {
    onSoap?: (result: StructureResult) => void;
    onChecklist?: (items: readonly ChecklistItem[]) => void;
    onError?: (message: string) => void;
  },
): () => void {
  const es = new EventSource(`${BASE}/scribe/sessions/${sessionId}/stream`);

  es.addEventListener("soap", (e) => {
    try { handlers.onSoap?.(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
  });
  es.addEventListener("checklist", (e) => {
    try { handlers.onChecklist?.(JSON.parse((e as MessageEvent).data).items); } catch { /* ignore */ }
  });
  es.addEventListener("error", (e) => {
    try {
      const d = JSON.parse((e as MessageEvent).data);
      handlers.onError?.(d.message);
    } catch { /* transport-level error, not a server frame */ }
  });

  return () => es.close();
}
