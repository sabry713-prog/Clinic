/**
 * ClaimActions — eligibility check, claim-draft assembly, and submission.
 *
 * All payer responses come from the configured NPHIES connector; in dev
 * that is the stub connector and every result is labelled as such. The
 * draft assembles clinician-confirmed artifacts only — blockers are
 * reported verbatim, never resolved automatically.
 */

import { useCallback, useState } from "react";
import { api, type ClaimDraft, type ClaimRecord, type EligibilityResult, ApiError } from "../../lib/api";

function formatTs(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function ClaimActions({ patientId }: { readonly patientId: string }): JSX.Element {
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [draft, setDraft] = useState<ClaimDraft | null>(null);
  const [claims, setClaims] = useState<readonly ClaimRecord[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = useCallback(async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }, []);

  const refreshClaims = useCallback(async () => {
    setClaims((await api.patients.listClaims(patientId)).data);
  }, [patientId]);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-slate-300">Claim actions</h3>

      {error && <p className="text-sm text-slate-400">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void act("elig", async () => setEligibility(await api.patients.checkEligibility(patientId)))}
          disabled={busy !== null}
          className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 disabled:opacity-50"
        >
          {busy === "elig" ? "Checking…" : "Check eligibility"}
        </button>
        <button
          type="button"
          onClick={() => void act("draft", async () => setDraft(await api.patients.claimDraft(patientId)))}
          disabled={busy !== null}
          className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 disabled:opacity-50"
        >
          {busy === "draft" ? "Assembling…" : "Assemble claim draft"}
        </button>
        <button
          type="button"
          onClick={() =>
            void act("submit", async () => {
              await api.patients.submitClaim(patientId);
              setDraft(await api.patients.claimDraft(patientId));
              await refreshClaims();
            })
          }
          disabled={busy !== null || draft === null || !draft.ready}
          className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
          title={draft === null ? "Assemble the draft first" : !draft.ready ? "Resolve blockers first" : undefined}
        >
          {busy === "submit" ? "Submitting…" : "Submit claim"}
        </button>
        <button
          type="button"
          onClick={() => void act("list", refreshClaims)}
          disabled={busy !== null}
          className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 disabled:opacity-50"
        >
          {busy === "list" ? "Loading…" : "Show submitted claims"}
        </button>
      </div>

      {eligibility && (
        <p className="text-xs text-slate-400">
          Eligibility: <span className="text-slate-200">{eligibility.status}</span>{" "}
          ({formatTs(eligibility.checked_at)}, {eligibility.mode} connector) — {eligibility.detail}
        </p>
      )}

      {draft && (
        <div className="text-xs space-y-1">
          {draft.ready ? (
            <p className="text-slate-300">
              Draft ready — {Array.isArray(draft.bundle?.["diagnosis"]) ? (draft.bundle["diagnosis"] as unknown[]).length : 0} diagnosis(es),{" "}
              {Array.isArray(draft.bundle?.["item"]) ? (draft.bundle["item"] as unknown[]).length : 0} claim item(s). Review and submit.
            </p>
          ) : (
            <>
              <p className="text-slate-400">Draft blocked — resolve first:</p>
              <ul className="list-disc ms-5 text-slate-500 space-y-0.5">
                {draft.blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {claims !== null && (
        <div className="text-xs">
          <p className="text-slate-500 mb-1">Submitted claims</p>
          {claims.length === 0 ? (
            <p className="text-slate-500">None yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {claims.map((c) => (
                <li key={c.id} className="text-slate-300" dir="ltr">
                  {formatTs(c.submitted_at)} — {c.item_count} item(s) —{" "}
                  <span className="text-slate-200">{c.status}</span>
                  <span className="text-slate-500"> ({c.mode} connector)</span>
                  {c.rejection_codes.length > 0 && (
                    <span className="text-slate-400"> — rejection codes: {c.rejection_codes.join(", ")}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
