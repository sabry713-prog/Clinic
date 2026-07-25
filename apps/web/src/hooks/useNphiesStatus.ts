/**
 * useNphiesStatus — live NPHIES badge state for one encounter (Sprint 9).
 *
 * Subscribes to `nphies_status_updated` events proxied through apps/core
 * (which enforces patient scope + RBAC + audit) from services/nphies-engine.
 * The browser never talks to the Python service directly.
 *
 * Transport is SSE, matching the AI Team stream built in Sprint 8. The event
 * name and payload are exactly as the spec defines; only the carrier differs,
 * and this flow is server-push only.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Badge states a payer response can produce.
 * `approved`/`pended` are payer decisions; `queued` is our own local state
 * while the transaction is in flight; `error` is a transport/config failure. */
export type NphiesLiveStatus =
  | "queued"
  | "approved"
  | "pended"
  | "error"
  | "eligible"
  | "not_eligible"
  | "connected";

export interface NphiesStatusEvent {
  readonly event: string;
  readonly encounter_id: string;
  readonly order_id: string | null;
  readonly status: NphiesLiveStatus;
  readonly authorization_number?: string | null;
  readonly disposition?: string | null;
  readonly detail?: string | null;
  /** "stub" | "live" — a stub response is development data, not a payer decision. */
  readonly mode?: string | null;
}

export interface UseNphiesStatusState {
  /** Latest event per order_id. */
  readonly byOrder: Readonly<Record<string, NphiesStatusEvent>>;
  /** Latest encounter-level event (eligibility), which carries no order_id. */
  readonly encounterEvent: NphiesStatusEvent | null;
  readonly connected: boolean;
  readonly error: string | null;
  /** Optimistically mark an order as in-flight the moment submit is clicked,
   * so the spinner appears without waiting for a server round-trip. */
  markQueued: (orderId: string) => void;
}

const API_BASE = (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "";

function isStatusEvent(data: unknown): data is NphiesStatusEvent {
  return typeof data === "object" && data !== null && "status" in data;
}

export function useNphiesStatus(
  patientId: string | null,
  encounterId: string | null,
): UseNphiesStatusState {
  const [byOrder, setByOrder] = useState<Record<string, NphiesStatusEvent>>({});
  const [encounterEvent, setEncounterEvent] = useState<NphiesStatusEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const encounterIdRef = useRef(encounterId);
  encounterIdRef.current = encounterId;

  const markQueued = useCallback((orderId: string) => {
    setByOrder((prev) => ({
      ...prev,
      [orderId]: {
        event: "nphies_status_updated",
        encounter_id: encounterIdRef.current ?? "",
        order_id: orderId,
        status: "queued",
      },
    }));
  }, []);

  useEffect(() => {
    setByOrder({});
    setEncounterEvent(null);
    setConnected(false);
    setError(null);

    if (!patientId || !encounterId) return;

    const source = new EventSource(
      `${API_BASE}/api/v1/patients/${patientId}/nphies/pre-auth/stream?encounter_id=${encodeURIComponent(encounterId)}`,
      { withCredentials: true },
    );

    source.addEventListener("open", () => setConnected(true));

    source.addEventListener("nphies_status_updated", (event) => {
      const raw = (event as MessageEvent<string>).data;
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        return; // malformed event — ignore rather than crash the stream
      }
      if (!isStatusEvent(data)) return;

      // The engine's first event confirms the subscription; it carries no outcome.
      if (data.status === "connected") {
        setConnected(true);
        return;
      }
      if (data.order_id) {
        setByOrder((prev) => ({ ...prev, [data.order_id as string]: data }));
      } else {
        setEncounterEvent(data);
      }
    });

    source.addEventListener("error", () => {
      setError("Lost connection to the NPHIES status stream.");
      setConnected(false);
    });

    return () => {
      source.close();
      setConnected(false);
    };
  }, [patientId, encounterId]);

  return { byOrder, encounterEvent, connected, error, markQueued };
}
