/**
 * Stage 5 — Submit. Eligibility runs automatically on stage entry (the
 * clinician navigated here deliberately; the check is simulated and
 * read-only). Readiness + the assembled draft bundle render live; one
 * explicit "Submit claim" (disabled until ready) sends the whole-patient
 * bundle through the simulated payer (stub returns accepted — honestly
 * labeled). Completion = a claim exists for this encounter session.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ClaimReadiness, type ClaimDraft, type EligibilityResult, type ClaimRecord, ApiError } from "../../../lib/api";

interface StageSubmitProps {
  readonly patientId: string;
  readonly encounterId: string | null;
  readonly refreshKey: number;
  readonly onDone: (done: boolean) => void;
}

export default function StageSubmit({ patientId, refreshKey, onDone }: StageSubmitProps): JSX.Element {
  const [readiness, setReadiness] = useState<ClaimReadiness | null>(null);
  const [draft, setDraft] = useState<ClaimDraft | null>(null);
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [claims, setClaims] = useState<readonly ClaimRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eligibilityStarted = useRef(false);

  const load = useCallback(() => {
    api.patients.claimReadiness(patientId).then(setReadiness).catch(() => setReadiness(null));
    api.patients.claimDraft(patientId).then(setDraft).catch(() => setDraft(null));
    api.patients.listClaims(patientId).then((r) => setClaims(r.data)).catch(() => setClaims([]));
  }, [patientId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Auto-run eligibility once per wizard session (the stage unmounts when
  // the clinician navigates away — the guard must outlive that, so it
  // lives in sessionStorage scoped to the patient).
  useEffect(() => {
    if (eligibilityStarted.current) return;
    eligibilityStarted.current = true;
    try {
      if (sessionStorage.getItem(`journey.eligibility.${patientId}`) != null) return;
      sessionStorage.setItem(`journey.eligibility.${patientId}`, "1");
    } catch {
      /* storage blocked — run the check; worst case it repeats */
    }
    api.patients
      .checkEligibility(patientId)
      .then(setEligibility)
      .catch(() => {
        /* readiness will surface the eligibility warning if this failed */
      });
  }, [patientId]);

  useEffect(() => {
    onDone(claims.length > 0 && readiness?.overall === "ready");
  }, [claims.length, readiness, onDone]);

  const submit = (): void => {
    setBusy(true); setError(null); setMsg(null);
    api.patients
      .submitClaim(patientId)
      .then((rec) => {
        setMsg(`Claim submitted — status: ${rec.status} (simulated payer, mode: ${rec.mode}).`);
        load();
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Submission failed"))
      .finally(() => setBusy(false));
  };

  const ready = draft?.ready === true;

  return (
    <section aria-label="Stage: Submit" data-testid="journey-stage-panel-submit" className="space-y-4">
      <header>
        <h2 className="text-lg font-bold text-ink">5 · Verify &amp; submit</h2>
        <p className="text-sm text-ink-soft">
          Eligibility was checked automatically on entering this stage. Review the readiness summary, then submit — one explicit click, nothing automatic.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-mist px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Eligibility (auto)</p>
          <p className="text-sm font-semibold text-ink" data-testid="eligibility-status">
            {eligibility ? eligibility.status : "checking…"}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-mist px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Readiness</p>
          <p className="text-sm font-semibold text-ink" data-testid="readiness-overall">
            {readiness ? readiness.overall : "…"}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-mist px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Claim bundle</p>
          <p className="text-sm font-semibold text-ink">
            {draft?.bundle ? "assembled" : draft ? "blocked" : "…"}
          </p>
        </div>
      </div>

      {readiness != null && (
        <ul className="space-y-1" data-testid="readiness-checks">
          {readiness.checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-sm">
              <span
                aria-hidden="true"
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  c.status === "pass" ? "bg-status-ok" : c.status === "warning" ? "bg-status-pend" : c.status === "fail" ? "bg-status-rej" : "bg-ink-faint"
                }`}
              />
              <span className="text-ink-deep">
                <span className="font-medium">{c.label}</span>
                <span className="text-ink-soft"> — {c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {draft != null && !ready && draft.blockers.length > 0 && (
        <div className="rounded-xl border border-status-rej-line bg-status-rej-bg px-3 py-2 text-sm text-status-rej" role="alert">
          <p className="font-semibold">Blockers:</p>
          <ul className="list-disc ms-5">
            {draft.blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={busy || !ready}
        data-testid="submit-claim"
        className="px-5 py-2.5 rounded-full bg-grad-accent text-white text-sm font-bold shadow-pill hover:brightness-110 disabled:opacity-50 disabled:shadow-none transition-all"
      >
        {busy ? "Submitting…" : "Submit claim"}
      </button>
      <p className="text-[11px] text-ink-faint">
        Simulated payer — the stub returns an administrative acceptance for demo purposes; it never represents a real NPHIES submission.
      </p>

      {claims.length > 0 && (
        <p className="text-sm text-ink-soft" data-testid="claims-count">
          {claims.length} submitted claim(s) on record — latest: {claims[claims.length - 1]!.status}.
        </p>
      )}
      {msg && <p className="text-sm text-status-ok" data-testid="submit-msg">{msg}</p>}
      {error && <p className="text-sm text-status-rej" role="alert">{error}</p>}
    </section>
  );
}
