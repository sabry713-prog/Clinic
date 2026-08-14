/**
 * useAgentOrchestrator — connects the Right Pane "AI Team" tabs (Pharmacist,
 * Consultant, NPHIES) to live updates from the tethered agent handlers
 * (services/orchestrator/agent_handlers.py, Sprint 8), proxied through
 * apps/core's SSE endpoint (apps/core/src/ai-team/) so the browser never
 * talks to the Python services directly (same discipline as every other
 * AI-touching feature this session).
 *
 * The Scribe tab is intentionally NOT covered here -- it's the existing
 * ambient-dictation flow (useDictation.ts), unrelated to NSCRE/DeepSeek
 * agent grounding.
 */

import { useEffect, useState } from "react";

export interface EvidenceStep {
  readonly node_type: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface EvidenceChain {
  readonly steps: readonly EvidenceStep[];
  readonly rendered: string;
  /** Verbatim Cypher statements the engine executed to produce this chain
   * (S4.1 terminal cutaway). Absent for deductions that ran no graph query
   * (e.g. reference-map SQL lookups, which carry their query text instead). */
  readonly cypher?: readonly string[];
}

export interface PharmacistResult {
  readonly agent: "pharmacist";
  readonly patient_id: string;
  readonly prose: string;
  readonly findings: {
    readonly drug_interactions: readonly unknown[];
    readonly dose_safety: readonly unknown[];
  };
  readonly evidence_chains: readonly EvidenceChain[];
}

export interface ConsultantResult {
  readonly agent: "consultant";
  readonly patient_id: string;
  readonly prose: string;
  readonly findings: {
    readonly drug_interactions: readonly unknown[];
    readonly dose_safety: readonly unknown[];
    readonly necessity: readonly unknown[];
  };
  readonly evidence_chains: readonly EvidenceChain[];
}

export type NphiesStatus = "GREEN" | "YELLOW" | "RED";

export interface NphiesCard {
  readonly medication: string;
  readonly status: NphiesStatus;
  readonly badge: string;
  readonly pre_auth_required: boolean;
  readonly suggested_codes: readonly { readonly icd10: string; readonly description: string }[];
  readonly evidence_chain: EvidenceChain | null;
}

export interface NphiesResult {
  readonly agent: "nphies";
  readonly patient_id: string;
  readonly prose: string;
  readonly cards: readonly NphiesCard[];
  readonly evidence_chains: readonly EvidenceChain[];
}

export interface UseAgentOrchestratorState {
  readonly pharmacist: PharmacistResult | null;
  readonly consultant: ConsultantResult | null;
  readonly nphies: NphiesResult | null;
  readonly connected: boolean;
  readonly error: string | null;
}

const API_BASE = (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "";

function isAgentPayload(data: unknown): data is { agent: string } {
  return typeof data === "object" && data !== null && "agent" in data;
}

/** `patientId === null` disconnects/resets -- no patient selected yet. */
export function useAgentOrchestrator(patientId: string | null): UseAgentOrchestratorState {
  const [pharmacist, setPharmacist] = useState<PharmacistResult | null>(null);
  const [consultant, setConsultant] = useState<ConsultantResult | null>(null);
  const [nphies, setNphies] = useState<NphiesResult | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPharmacist(null);
    setConsultant(null);
    setNphies(null);
    setConnected(false);
    setError(null);

    if (!patientId) return;

    const source = new EventSource(`${API_BASE}/api/v1/patients/${patientId}/ai-team/stream`, {
      withCredentials: true,
    });

    source.addEventListener("open", () => setConnected(true));

    source.addEventListener("agent_update", (event) => {
      const raw = (event as MessageEvent<string>).data;
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        return; // malformed event -- ignore rather than crash the stream
      }
      if (!isAgentPayload(data)) return;
      if (data.agent === "pharmacist") setPharmacist(data as PharmacistResult);
      else if (data.agent === "consultant") setConsultant(data as ConsultantResult);
      else if (data.agent === "nphies") setNphies(data as NphiesResult);
    });

    source.addEventListener("done", () => {
      source.close();
      setConnected(false);
    });

    source.addEventListener("error", () => {
      setError("Lost connection to the AI Team agents.");
      setConnected(false);
    });

    return () => {
      source.close();
      setConnected(false);
    };
  }, [patientId]);

  return { pharmacist, consultant, nphies, connected, error };
}
