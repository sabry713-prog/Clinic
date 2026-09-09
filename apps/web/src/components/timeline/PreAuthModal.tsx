/**
 * PreAuthModal — 1-click NPHIES pre-authorization (Sprint 9).
 *
 * Opened by clicking a 🟡 Pre-auth-required badge. Shows the exact fields that
 * will go into the FHIR Claim bundle and the clinical justification that will be
 * attached, then submits.
 *
 * Two deliberate honesty constraints:
 *
 * 1. Every field shown here is passed through to the bundle verbatim. Nothing on
 *    this screen is inferred, mapped, or substituted — the codes are the ones the
 *    clinician already confirmed (CLAUDE.md §1).
 * 2. The result rendered afterwards is whatever the payer returned. An undecided
 *    response renders as Pended, never as Approved, and a stub-connector response
 *    is labelled as development data rather than a payer decision.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, X, FileText, AlertTriangle } from "lucide-react";

export interface PreAuthFields {
  readonly orderId: string;
  readonly encounterId: string;
  readonly orderDisplay: string;
  readonly sbsCode: string;
  readonly sbsDisplay?: string | undefined;
  readonly icd10Code: string;
  readonly icd10Display?: string | undefined;
  readonly payerId?: string | undefined;
  /** Draft SOAP note attached to the claim as clinical justification. */
  readonly clinicalDocument: string;
}

interface PreAuthModalProps {
  readonly fields: PreAuthFields;
  readonly onClose: () => void;
  readonly onSubmit: (fields: PreAuthFields) => Promise<void>;
  /** Set when the shell has no real patient wired in, so submission would have
   * nothing to send to. Renders an explanation instead of a dead button. */
  readonly disabledReason?: string | undefined;
}

function Field({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2">
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-ink-soft">{label}</span>
      <span className={`text-right text-xs text-ink ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

export default function PreAuthModal({
  fields,
  onClose,
  onSubmit,
  disabledReason,
}: PreAuthModalProps): JSX.Element {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(fields);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Submit pre-authorisation to NPHIES"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-line bg-white shadow-2xl">
        <header className="flex items-center gap-2 border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Pre-authorisation request</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="ms-auto rounded-md p-1 text-ink-soft hover:bg-veil hover:text-ink disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="px-5 py-3">
          <p className="mb-3 text-[11px] leading-relaxed text-ink-soft">
            These values are sent to NPHIES exactly as shown. Codes are the ones already
            confirmed for this order — nothing here is generated or substituted.
          </p>

          <Field label="Order" value={fields.orderDisplay} />
          <Field
            label="Procedure (SBS)"
            value={fields.sbsDisplay ? `${fields.sbsCode} — ${fields.sbsDisplay}` : fields.sbsCode}
            mono
          />
          <Field
            label="Diagnosis (ICD-10-AM)"
            value={fields.icd10Display ? `${fields.icd10Code} — ${fields.icd10Display}` : fields.icd10Code}
            mono
          />
          <Field label="Encounter" value={fields.encounterId} mono />
          {fields.payerId && <Field label="Payer" value={fields.payerId} mono />}

          <div className="mt-3">
            <div className="mb-1 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-ink-soft" aria-hidden="true" />
              <span className="text-[11px] uppercase tracking-wide text-ink-soft">
                Attached clinical justification
              </span>
            </div>
            <pre
              data-testid="clinical-justification"
              className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-line bg-wash p-2.5 text-[11px] leading-relaxed text-ink-deep"
            >
              {fields.clinicalDocument}
            </pre>
          </div>

          {disabledReason && (
            <p className="mt-3 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-status-pend">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {disabledReason}
            </p>
          )}

          {error && (
            <p role="alert" className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-[11px] text-rose-300">
              {error}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-deep hover:bg-veil disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || Boolean(disabledReason)}
            className="inline-flex items-center gap-1.5 rounded-full bg-grad-accent shadow-pill px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Submitting…
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                Submit Pre-Auth to NPHIES Now
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
