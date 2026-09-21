/**
 * Stage 3 — Order. Both deterministic extractors run automatically on
 * entry (documented-notes candidates + the SOAP-draft matcher), merged
 * and deduped into pre-checked rows (per-item veto by unchecking), and
 * one "Create selected orders" uses the existing batch endpoint.
 * Completion = at least one active order on record.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ServiceCandidate, type ServiceRequestItem, type NecessityVerdict, ApiError } from "../../../lib/api";


/** The payer's reading of one order. Coloured on purpose: this is the ordering decision, not
 * the read-only chart, and it is the same badge vocabulary the encounter's order entry uses. */
function NecessityBadge({ verdict }: { readonly verdict: NecessityVerdict }): JSX.Element {
  const styles: Record<NecessityVerdict["status"], string> = {
    GREEN: "border-status-ok-line bg-status-ok-bg text-status-ok",
    YELLOW: "border-amber-300 bg-amber-50 text-amber-800",
    RED: "border-rose-300 bg-rose-50 text-rose-800",
    UNAVAILABLE: "border-line bg-white text-ink-faint",
    NO_DIAGNOSIS: "border-amber-300 bg-amber-50 text-amber-800",
  };
  const labels: Record<NecessityVerdict["status"], string> = {
    GREEN: "payable",
    YELLOW: "pre-auth",
    RED: "no rule",
    UNAVAILABLE: "unchecked",
    NO_DIAGNOSIS: "not checkable",
  };
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${styles[verdict.status]}`}
      data-testid={`order-necessity-${verdict.status}`}
    >
      {labels[verdict.status]}
    </span>
  );
}

interface StageOrderProps {
  readonly patientId: string;
  /** Encounter whose saved note supplies the plan text, when one is open. */
  readonly encounterId?: string | null;
  readonly onDone: (done: boolean) => void;
  readonly onChanged: () => void;
}

function keyOf(c: ServiceCandidate): string {
  return `${c.code}|${c.code_display}`;
}

/** The plan text this stage matches orders against: the SAVED note first, the browser session only
 *  as a fallback — the same rule stage 2 learned the hard way.
 *
 *  Reported from testing as "I cannot move to the 3rd step": this stage read the browser session
 *  alone, so any refresh, sign-out, or fresh tab emptied it while the record still held the note.
 *  Stage 2 (which reads the saved draft) showed the diagnoses; stage 3 showed "nothing new to
 *  propose" from the same encounter, and the two screens disagreed about the same note. A stage may
 *  not depend on a browser tab having survived; the record is the source of truth. */
async function loadSoapText(patientId: string, encounterId?: string | null): Promise<string> {
  const fromSession = (): string => {
    try {
      const raw = sessionStorage.getItem(`cortex.scribe.${patientId}`);
      if (!raw) return "";
      const parsed = JSON.parse(raw) as { soap?: Partial<Record<"subjective" | "objective" | "assessment" | "plan", string>> };
      return [parsed.soap?.subjective, parsed.soap?.objective, parsed.soap?.assessment, parsed.soap?.plan]
        .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        .join(" ");
    } catch {
      return "";
    }
  };

  try {
    // Same lookup as stage 2's loadSoapAssessment — this encounter's note when the row identifies one,
    // the newest otherwise.
    const list = await api.patients.listDrafts(patientId);
    const notes = (list.data ?? [])
      .filter((d) => d.document_type === "encounter_note")
      .filter((d) => !encounterId || !d.encounter_id || d.encounter_id === encounterId)
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const newest = notes[0];
    if (newest) {
      const draft = await api.drafts.get(newest.id);
      const saved = (draft.sections_json ?? [])
        .filter((s) => s.text?.trim())
        .map((s) => s.text.trim())
        .join(" ");
      if (saved) return saved;
    }
  } catch {
    /* fall through to the session */
  }

  return fromSession();
}

export default function StageOrder({ patientId, encounterId, onDone, onChanged }: StageOrderProps): JSX.Element {
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
    setLoading(true);
    // A stage that can stall forever is a stage a clinician cannot leave. Every lookup below is
    // therefore capped: whatever arrives in time is proposed, and the step opens either way. This
    // was reported as "I cannot move to the 3rd step" — the step had opened, and sat on
    // "Analyzing notes and the SOAP draft…" past the point where anyone waits.
    const capped = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
    Promise.all([
      capped(
        api.patients.serviceRequestCandidates(patientId).then((r) => r.data).catch(() => [] as readonly ServiceCandidate[]),
        8000,
        [] as readonly ServiceCandidate[],
      ),
      capped(
        loadSoapText(patientId, encounterId).then((soapText) =>
          soapText
            ? api.patients.matchQuickEntry(patientId, soapText).then((r) => r.data).catch(() => [] as readonly ServiceCandidate[])
            : Promise.resolve([] as readonly ServiceCandidate[]),
        ),
        8000,
        [] as readonly ServiceCandidate[],
      ),
    ]).then(([fromNotes, fromSoap]) => {
      if (cancelled) return;
      const merged = new Map<string, ServiceCandidate>();
      for (const c of [...fromNotes, ...fromSoap]) merged.set(keyOf(c), c);
      const list = [...merged.values()];
      setRows(list);
      setSelected(new Set(list.map(keyOf)));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [patientId, encounterId, refresh]);

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
              <li key={keyOf(c)} className="rounded-xl border border-line bg-mist px-3 py-2">
                <div className="flex items-center gap-2.5">
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
                  {c.necessity && <NecessityBadge verdict={c.necessity} />}
                  <span className="font-mono text-[11px] text-ink-faint" dir="ltr">{c.code}</span>
                </div>
                {c.necessity?.status === "GREEN" && c.necessity.justifying_display && (
                  <p className="mt-1 ps-6 text-[11px] text-ink-soft" data-testid="order-justified-by">
                    Justified by {c.necessity.justifying_icd10} · {c.necessity.justifying_display}
                  </p>
                )}
                {c.necessity?.status === "YELLOW" && (
                  <p className="mt-1 ps-6 text-[11px] text-ink-soft" data-testid="order-pre-auth">
                    Pre-authorization is required for this order
                    {c.necessity.justifying_icd10 ? ` (justified by ${c.necessity.justifying_icd10})` : ""}.
                  </p>
                )}
                {c.necessity?.status === "RED" && (
                  <div className="mt-1 ps-6 text-[11px] text-ink-soft" data-testid="order-no-rule">
                    <p>No payer rule covers this order, so it would be rejected as it stands.</p>
                    {c.necessity.suggested_codes.length > 0 ? (
                      <p className="mt-0.5">
                        To make it payable, document one of:{" "}
                        {c.necessity.suggested_codes
                          .map((s) => `${s.icd10} · ${s.description}`)
                          .join(" · ")}
                      </p>
                    ) : (
                      <p className="mt-0.5">
                        No diagnosis on file justifies it either — check the payer&apos;s cover before
                        ordering.
                      </p>
                    )}
                  </div>
                )}
                {c.prerequisite && !c.prerequisite.satisfied && (
                  <p className="mt-1 ps-6 text-[11px] text-ink-soft" data-testid="order-prerequisite">
                    {c.prerequisite.prior_state === "ordered"
                      ? `${c.prerequisite.requires_display} is ordered but no result is on file yet — this order should wait for it.`
                      : `Needs ${c.prerequisite.requires_display} on record first — none is on file for this patient.`}{" "}
                    {c.prerequisite.rationale}
                  </p>
                )}
                {c.necessity?.status === "NO_DIAGNOSIS" && (
                  <p className="mt-1 ps-6 text-[11px] text-ink-soft" data-testid="order-no-diagnosis">
                    No coded diagnosis is on file for this patient, so this order has nothing to be
                    checked against. Confirm the diagnosis and its code in step 2, then come back —
                    a claim is judged on codes, not on the assessment wording.
                  </p>
                )}
                {c.necessity?.status === "UNAVAILABLE" && (
                  <p className="mt-1 ps-6 text-[11px] text-ink-soft" data-testid="order-unavailable">
                    The payer rules could not be reached, so this order has not been checked.
                  </p>
                )}
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
