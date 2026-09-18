/**
 * InsurancePanel — who covers this patient, and what the payer last said.
 *
 * The chart's rule is no colour-coding, no severity flags, no interpretation -- and it holds for
 * a payer answer too, so the eligibility status is stated as text here. The coloured badge
 * belongs where the ordering decision is made, not in the read-only chart. (A test enforces the
 * chart rule; it caught the first version of this panel, which was coloured.)
 *
 * What is shown is administrative: which payer, which plan (the grid the desk asks about), which
 * membership, and the payer's own eligibility answer.
 *
 * `mode` matters and is shown: in dev the connector is a stub, and a stub answer must never read
 * as a payer decision.
 */
import { useState } from "react";
import { ShieldCheck, RefreshCw } from "lucide-react";
import { api, type PatientInsurance } from "../../lib/api";

/** Plain wording for the payer's answer. No colour: this is the read-only chart. */
const STATUS_LABELS: Record<string, string> = {
  eligible: "Eligible",
  not_eligible: "Not eligible",
  error: "Check failed",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export default function InsurancePanel({
  patientId,
  data,
  isLoading,
  onChecked,
}: {
  readonly patientId: string;
  readonly data: PatientInsurance | null;
  readonly isLoading: boolean;
  readonly onChecked?: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const runCheck = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      await api.patients.checkEligibility(patientId);
      setMessage("Eligibility check recorded.");
      onChecked?.();
    } catch {
      setMessage("The eligibility check could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  const covers = data?.covers ?? [];
  const last = data?.last_eligibility ?? null;

  return (
    <section className="rounded-2xl border border-line bg-white p-5" aria-label="Insurance">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
          <ShieldCheck className="h-4 w-4 text-ink-soft" aria-hidden="true" />
          Insurance cover
        </h3>
        <button
          type="button"
          onClick={runCheck}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-mist disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
          {busy ? "Checking…" : "Run eligibility check"}
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-ink-soft">Loading cover…</p>
      ) : covers.length === 0 ? (
        <p className="text-sm text-ink-soft" data-testid="insurance-empty">
          No insurance cover is recorded for this patient. Claims for this encounter cannot be
          checked against a payer until it is entered.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="insurance-covers">
          {covers.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-line bg-mist/40 px-3 py-2 text-sm"
            >
              <span className="font-semibold text-ink">{c.payer_name}</span>
              {c.plan_name && <span className="text-ink-deep">{c.plan_name}</span>}
              {c.klass && <span className="text-ink-soft">class {c.klass}</span>}
              {c.network_tier && <span className="text-ink-soft">tier {c.network_tier}</span>}
              <span className="font-mono text-[11px] text-ink-faint">
                {c.policy_number} · member {c.member_id}
              </span>
              <span className="text-[11px] text-ink-faint">
                {c.in_force ? `in force from ${c.effective_from}` : `expired ${c.effective_to ?? ""}`}
              </span>
              {c.source !== "payer-feed" && (
                <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] text-ink-faint">
                  {c.source}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 border-t border-line pt-3">
        {last ? (
          <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="insurance-eligibility">
            <span className="text-sm font-semibold text-ink">Eligibility: {statusLabel(last.status)}</span>
            <span className="text-ink-soft">last checked {last.checked_at.slice(0, 19).replace("T", " ")}</span>
            <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] text-ink-faint">
              {last.mode === "live" ? "payer response" : "stub — development data, not a payer decision"}
            </span>
          </p>
        ) : (
          <p className="text-sm text-ink-soft" data-testid="insurance-no-check">
            No eligibility check has been run for this patient yet.
          </p>
        )}
        {message && <p className="mt-2 text-xs text-ink-soft">{message}</p>}
      </div>
    </section>
  );
}
