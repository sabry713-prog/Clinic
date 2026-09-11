/**
 * Stage 3 — Order. Both deterministic extractors run automatically on
 * entry (documented-notes candidates + the SOAP-draft matcher), merged
 * and deduped into pre-checked rows (per-item veto by unchecking), and
 * one "Create selected orders" uses the existing batch endpoint.
 * Completion = at least one active order on record.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ServiceCandidate, type ServiceRequestItem, ApiError } from "../../../lib/api";

interface StageOrderProps {
  readonly patientId: string;
  readonly onDone: (done: boolean) => void;
  readonly onChanged: () => void;
}

function keyOf(c: ServiceCandidate): string {
  return `${c.code}|${c.code_display}`;
}

function readSoapText(patientId: string): string {
  try {
    const raw = sessionStorage.getItem(`sully.scribe.${patientId}`);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { soap?: Partial<Record<"subjective" | "objective" | "assessment" | "plan", string>> };
    return [parsed.soap?.subjective, parsed.soap?.objective, parsed.soap?.assessment, parsed.soap?.plan]
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      .join(" ");
  } catch {
    return "";
  }
}

export default function StageOrder({ patientId, onDone, onChanged }: StageOrderProps): JSX.Element {
  const [existing, setExisting] = useState<readonly ServiceRequestItem[]>([]);
  const [rows, setRows] = useState<readonly ServiceCandidate[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.patients.serviceRequests(patientId).then((r) => setExisting(r.data)).catch(() => { /* silent */ });
  }, [patientId]);

  // Auto-run on entry: existing orders + merged candidate proposals.
  useEffect(() => {
    let cancelled = false;
    refresh();
    const soapText = readSoapText(patientId);
    setLoading(true);
    Promise.all([
      api.patients.serviceRequestCandidates(patientId).then((r) => r.data).catch(() => [] as readonly ServiceCandidate[]),
      soapText
        ? api.patients.matchQuickEntry(patientId, soapText).then((r) => r.data).catch(() => [] as readonly ServiceCandidate[])
        : Promise.resolve([] as readonly ServiceCandidate[]),
    ]).then(([fromNotes, fromSoap]) => {
      if (cancelled) return;
      const merged = new Map<string, ServiceCandidate>();
      for (const c of [...fromNotes, ...fromSoap]) merged.set(keyOf(c), c);
      const list = [...merged.values()];
      setRows(list);
      setSelected(new Set(list.map(keyOf)));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [patientId, refresh]);

  useEffect(() => {
    onDone(existing.length > 0);
  }, [existing, onDone]);

  const existingCodes = useMemo(() => new Set(existing.map((o) => `${o.code ?? ""}|${o.code_display ?? ""}`)), [existing]);
  const rowsToCreate = rows.filter((r) => selected.has(keyOf(r)) && !existingCodes.has(keyOf(r)));

  const toggle = (k: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const createSelected = (): void => {
    if (rowsToCreate.length === 0) return;
    setBusy(true); setError(null); setMsg(null);
    api.patients
      .createServiceRequests(patientId, rowsToCreate)
      .then(() => {
        setMsg(`Created ${rowsToCreate.length} order(s).`);
        setSelected(new Set());
        refresh();
        onChanged();
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to create orders"))
      .finally(() => setBusy(false));
  };

  return (
    <section aria-label="Stage: Order" data-testid="journey-stage-panel-order" className="space-y-4">
      <header>
        <h2 className="text-lg font-bold text-ink">3 · Orders</h2>
        <p className="text-sm text-ink-soft">
          Candidates from the documented notes and this encounter's SOAP draft, matched automatically and pre-selected — uncheck anything to veto.
        </p>
      </header>

      <p className="text-sm text-ink-soft">
        <span className="font-semibold text-ink">{existing.length}</span> active order(s) already on record.
      </p>

      {loading && <p className="text-sm text-ink-faint" data-testid="order-loading">Analyzing notes and the SOAP draft…</p>}

      {!loading && rows.length > 0 && (
        <div>
          <h3 className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-faint mb-2">
            Proposed orders — proposed by the system, approved by you
          </h3>
          {rowsToCreate.length === 0 && (
            <p className="text-sm text-status-ok bg-status-ok-bg border border-status-ok-line rounded-xl px-3 py-2" data-testid="order-all-on-record">
              All matched services are already on record — nothing new to create.
            </p>
          )}
          <ul className="space-y-1.5">
            {rowsToCreate.map((c) => (
              <li key={keyOf(c)} className="flex items-center gap-2.5 rounded-xl border border-line bg-mist px-3 py-2">
                <input
                  type="checkbox"
                  checked={selected.has(keyOf(c))}
                  onChange={() => toggle(keyOf(c))}
                  aria-label={c.code_display}
                  className="h-4 w-4 accent-brand-indigo"
                />
                <span className="min-w-0 flex-1 text-sm text-ink truncate" dir="ltr">
                  <span className="font-medium">{c.code_display}</span>
                  <span className="text-ink-soft text-xs"> · {c.category}</span>
                </span>
                <span className="font-mono text-[11px] text-ink-faint" dir="ltr">{c.code}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={createSelected}
            disabled={busy || rowsToCreate.length === 0}
            data-testid="create-selected-orders"
            className="mt-3 px-4 py-2 rounded-full bg-grad-accent text-white text-sm font-semibold shadow-pill hover:brightness-110 disabled:opacity-50 transition-all"
          >
            {busy ? "Creating…" : `Create selected orders (${rowsToCreate.length})`}
          </button>
        </div>
      )}

      {!loading && rows.length === 0 && (
        <p className="text-sm text-status-ok bg-status-ok-bg border border-status-ok-line rounded-xl px-3 py-2" data-testid="order-all-set">
          Nothing new to propose — every matched service is already on record.
        </p>
      )}

      {msg && <p className="text-sm text-status-ok">{msg}</p>}
      {error && <p className="text-sm text-status-rej" role="alert">{error}</p>}
    </section>
  );
}
