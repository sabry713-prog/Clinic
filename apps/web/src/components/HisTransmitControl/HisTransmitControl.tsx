/**
 * HisTransmitControl — send a confirmed order/refill to the hospital HIS
 * (dummy/stub Hospital System connector — see docs/architecture/his-connector-hospital-sys.md).
 *
 * Status is shown with ONE neutral style regardless of outcome — this is an
 * administrative transmission status, never a clinical-severity indicator
 * (CLAUDE.md §2). On rejection, the backend's own reason is shown verbatim in
 * a disclosure, exactly as returned — never rephrased or interpreted here.
 */

import { useState, useEffect, useCallback } from "react";
import { api, type HisTransmission, type HisTransmissionSourceType, ApiError } from "../../lib/api";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  accepted: "Accepted by Hospital System",
  rejected: "Rejected by Hospital System",
  failed: "Transmission failed",
};

export default function HisTransmitControl({
  patientId,
  sourceType,
  sourceId,
}: {
  readonly patientId: string;
  readonly sourceType: HisTransmissionSourceType;
  readonly sourceId: string;
}): JSX.Element {
  const [transmission, setTransmission] = useState<HisTransmission | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReason, setShowReason] = useState(false);

  const refresh = useCallback(() => {
    api.patients
      .hisTransmissions(patientId)
      .then((r) => {
        const match = r.data.find((t) => t.source_type === sourceType && t.source_id === sourceId);
        setTransmission(match ?? null);
      })
      .catch(() => setTransmission(null));
  }, [patientId, sourceType, sourceId]);

  useEffect(() => { refresh(); }, [refresh]);

  const transmit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.patients.transmitToHis(patientId, sourceType, sourceId);
      setTransmission(result);
      setShowReason(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Transmission failed");
    } finally {
      setBusy(false);
    }
  }, [patientId, sourceType, sourceId]);

  if (transmission === undefined) return <span className="text-xs text-slate-600">…</span>;

  if (transmission === null) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={() => void transmit()}
          disabled={busy}
          className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send to Hospital System"}
        </button>
        {error && <span className="text-xs text-slate-500">{error}</span>}
      </span>
    );
  }

  const canRetry = transmission.status === "rejected" || transmission.status === "failed";

  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <span className="text-xs text-slate-400 bg-slate-800 rounded px-1.5 py-0.5">
        {STATUS_LABEL[transmission.status] ?? transmission.status}
      </span>
      {transmission.backend_reason_text && (
        <button type="button" onClick={() => setShowReason((v) => !v)} className="text-xs text-slate-500 hover:text-slate-300 underline">
          {showReason ? "Hide reason" : "Review reason"}
        </button>
      )}
      {canRetry && (
        <button
          type="button"
          onClick={() => void transmit()}
          disabled={busy}
          className="text-xs px-2 py-1 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 disabled:opacity-50"
        >
          {busy ? "Sending…" : "Retry"}
        </button>
      )}
      {error && <span className="text-xs text-slate-500">{error}</span>}
      {showReason && transmission.backend_reason_text && (
        <p className="basis-full text-xs text-slate-400 border-s-2 border-slate-700 ps-3 mt-1" dir="auto">
          {transmission.backend_reason_text}
        </p>
      )}
    </span>
  );
}
