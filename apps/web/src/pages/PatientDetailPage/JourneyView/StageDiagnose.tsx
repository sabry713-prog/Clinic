/**
 * Stage 2 — Diagnose. The SOAP assessment is analyzed on entry (existing
 * deterministic suggester + spelling assist); already-documented problems
 * are shown as on-file (nothing to do). The clinician taps suggestions to
 * select, one "Add selected" creates them (suggest→confirm unchanged).
 * Completion = the record already has at least one active diagnosis.
 *
 * The assessment it analyses comes from the SAVED note first, with the browser
 * session only as a fallback — see loadSoapAssessment.
 */

import { useEffect, useMemo, useState } from "react";
import { api, type PatientDetail, type CodedTerm, ApiError } from "../../../lib/api";

interface StageDiagnoseProps {
  readonly patient: PatientDetail;
  /** The encounter this diagnosis is being made in, recorded as provenance on the write. */
  readonly encounterId?: string | null;
  /** Offered when this stage has nothing for the clinician to decide (see the "nothing to add"
   *  block) — the way on, without sending them to another surface to finish the step. */
  readonly onAdvance?: () => void;
  readonly onDone: (done: boolean) => void;
  readonly onChanged: () => void;
}

function readSessionAssessment(patientId: string): string {
  try {
    const raw = sessionStorage.getItem(`cortex.scribe.${patientId}`);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { soap?: Partial<Record<"assessment" | "plan", string>> };
    // The ASSESSMENT only. The plan holds orders -- "kidney ultrasound", "urine culture" --
    // and feeding those to a diagnosis suggester produced "Chronic kidney disease" from the
    // word "kidney". Orders are tasks, not diagnoses; the checklist reads the plan, this reads
    // the place the clinician states the diagnosis.
    return typeof parsed.soap?.assessment === "string" ? parsed.soap.assessment.trim() : "";
  } catch {
    return "";
  }
}

/**
 * The assessment this stage analyses: the SAVED note first, the browser session only as a fallback.
 *
 * Reading the session draft alone made this step depend on the tab staying open — closing it emptied
 * the stage while the note sat on the record. Stage 1 already saves the reviewed note through the
 * drafts API, and its comment promises later stages can reach it; this is that promise kept.
 */
async function loadSoapAssessment(patientId: string, encounterId?: string | null): Promise<string> {
  try {
    const list = await api.patients.listDrafts(patientId);
    const notes = (list.data ?? [])
      .filter((d) => d.document_type === "encounter_note")
      // This encounter's note when the row identifies one. Rows written before the column existed
      // carry none and fall back to the newest — all the older data allows, and the reason the
      // column was added: on a two-encounter day, recency picks the other visit's note.
      .filter((d) => !encounterId || !d.encounter_id || d.encounter_id === encounterId)
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const newest = notes[0];
    if (newest) {
      const draft = await api.drafts.get(newest.id);
      const saved = (draft.sections_json ?? []).find((s) => s.key === "assessment")?.text?.trim() ?? "";
      if (saved) return saved;
    }
  } catch {
    /* the record could not be reached — the session draft below still works */
  }
  return readSessionAssessment(patientId);
}

export default function StageDiagnose({ patient, encounterId, onAdvance, onDone, onChanged }: StageDiagnoseProps): JSX.Element {
  const documented = patient.conditions ?? [];
  // The ten most recent, newest first. The list arrives in insertion order, so the diagnosis the
  // clinician just confirmed is the last entry — and a plain first-ten slice hid exactly that one.
  // Reported as "diagnoses is not appears in the diagnoses after been added": the count went up and
  // the new diagnosis was nowhere in sight.
  const recentDocumented = documented.slice(-10).reverse();
  const [candidates, setCandidates] = useState<readonly CodedTerm[]>([]);
  const [didYouMean, setDidYouMean] = useState<readonly CodedTerm[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [analyzedText, setAnalyzedText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-read the note while the step is on screen — from the record, and again on focus. This was a
  // useMemo keyed on the patient id alone, so the analysis ran once and never noticed a note edited
  // afterwards: coming back to the step showed suggestions for a note that no longer existed.
  const [assessment, setAssessment] = useState("");
  useEffect(() => {
    let live = true;
    const load = (): void => {
      void loadSoapAssessment(patient.id, encounterId).then((text) => {
        if (live) setAssessment(text);
      });
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      live = false;
      window.removeEventListener("focus", load);
    };
  }, [patient.id, encounterId]);
  const hasDocumentedDiagnosis = documented.length > 0;

  useEffect(() => {
    onDone(hasDocumentedDiagnosis);
  }, [hasDocumentedDiagnosis, onDone]);

  // Analyze the assessment on entry, and again whenever it changes: this step follows the SOAP
  // step, so the note it reads is the one the clinician just wrote. `analyzedText` records which
  // text produced the current suggestions, in place of the old once-only boolean.
  useEffect(() => {
    if (!assessment || analyzedText === assessment) return;
    setAnalyzedText(assessment);
    api.patients
      .suggestCodes(assessment)
      .then((r) => {
        setCandidates(r.suggestions);
        setDidYouMean(r.did_you_mean ?? []);
        setSelected(new Set(r.suggestions.map((t) => t.code)));
      })
      .catch(() => {
        /* analysis is a convenience — manual entry still works below */
      });
  }, [assessment, analyzedText]);

  // The vocabulary search. The matcher reads the note; this reads what the clinician types — the only
  // remedy when the note's wording is not in the curated list. Before this, that case said "nothing
  // matched" and the clinician had to leave the wizard to add the diagnosis on another surface.
  const [query, setQuery] = useState("");
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setSearchNote(null);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      api.patients
        .suggestCodes(q)
        .then((r) => {
          if (!live) return;
          // Merge into the SAME list the matcher fills. "Add selected" filters `candidates` to write,
          // so merging keeps the write path byte-for-byte what it was — only the source of the terms
          // changes. This is why the box needs no new endpoint and no new button.
          setCandidates((prev) => {
            const seen = new Set(prev.map((t) => t.code));
            return [...prev, ...r.suggestions.filter((t) => !seen.has(t.code))];
          });
          setSelected((prev) => new Set([...prev, ...r.suggestions.map((t) => t.code)]));
          setSearchNote(
            r.suggestions.length > 0
              ? null
              : "No coded term matches that wording. The list is curated, so a missing term is a vocabulary gap to be sourced — not a code to invent.",
          );
        })
        .catch(() => {
          if (live) setSearchNote("The coded vocabulary could not be reached.");
        })
        .finally(() => {
          if (live) setSearching(false);
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const toggle = (code: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const addSelected = (): void => {
    if (selected.size === 0) return;
    setBusy(true); setError(null); setMsg(null);
    const chosen = candidates.filter((t) => selected.has(t.code));
    Promise.all(chosen.map((t) => api.patients.addCondition(patient.id, {
            code: t.code,
            code_display: t.code_display,
            status: "active",
            // Provenance on the write: which encounter asked for this diagnosis. Without it the
            // problem list cannot say what this visit was for (a gap found by asking the question
            // out loud), and the claim has no encounter-level justification to point at.
            // Conditional spread, not `encounter_id: x ?? undefined`: the project builds with
            // exactOptionalPropertyTypes, so an explicit undefined is not an absent property.
            ...(encounterId ? { encounter_id: encounterId } : {}),
          })))
      .then(() => {
        setMsg(`Added ${chosen.length} diagnosis(es) to the problem list.`);
        setCandidates([]); setSelected(new Set());
        onChanged();
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to add diagnosis"))
      .finally(() => setBusy(false));
  };

  return (
    <section aria-label="Stage: Diagnose" data-testid="journey-stage-panel-diagnose" className="space-y-4">
      <header>
        <h2 className="text-lg font-bold text-ink">2 · Diagnoses</h2>
        <p className="text-sm text-ink-soft">
          {assessment
            ? "The SOAP assessment was analyzed. Confirm what belongs on the problem list — you author the diagnosis and confirm its code."
            : "This encounter's SOAP note has no assessment yet. Write it in step 1 and suggestions " +
              "appear here on their own — you author the diagnosis and confirm its code. During a " +
              "dictation the note fills progressively, so this step catches up as soon as the " +
              "assessment lands; until then there is nothing to suggest, which is the honest state " +
              "rather than a broken one."}
        </p>
      </header>

      <div>
        <h3 className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-faint mb-2">
          On file — {documented.length} documented diagnosis(es)
        </h3>
        {documented.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" dir="ltr">
            {recentDocumented.map((c) => (
              <li key={c.id} className="text-xs px-2.5 py-1 rounded-full border border-line bg-mist text-ink-deep">
                {c.code_display ?? "Unknown"}
                <span className="text-ink-faint"> · {c.status ?? ""}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-soft">No documented diagnoses yet — add from the suggestions below.</p>
        )}
      </div>

      <div>
        <label
          htmlFor="diagnose-search"
          className="block text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-faint mb-1"
        >
          Search the coded vocabulary
        </label>
        <input
          id="diagnose-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type the clinical term — e.g. urinary tract infection"
          data-testid="diagnose-vocabulary-search"
          className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-brand-indigo/30"
        />
        <p className="mt-1 text-[11px] text-ink-faint">
          {searching
            ? "Searching the vocabulary…"
            : "Coded terms only. Searching is not ordering: nothing is added until you confirm below."}
        </p>
        {searchNote && (
          <p className="mt-1 text-xs text-status-pend" data-testid="diagnose-search-note">
            {searchNote}
          </p>
        )}
      </div>

      {assessment && candidates.length > 0 && (
        <div>
          <h3 className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-faint mb-1">
            Suggested from this encounter's assessment — proposed by the system, approved by you
          </h3>
          {/* Reported from testing as "I cannot find the diagnosis from step 1": the proposals are
              below, pre-selected and ready — but they are NOT on the problem list above, and nothing
              said so. The step proposes and the clinician confirms; that is the design, and a design
              the reader cannot see is a design that looks broken. */}
          <p className="text-xs text-ink-soft mb-2" data-testid="diagnose-not-yet-on-file">
            These are proposals, not yet on the problem list. Press <span className="font-semibold">Add
            selected</span> to put them on it — they then appear under “On file” above, in this
            patient's record.
          </p>
          <ul className="space-y-1.5">
            {candidates.map((t) => (
              <li key={t.code}>
                <label className="flex items-center gap-2.5 text-sm text-ink cursor-pointer">
                  <input type="checkbox" checked={selected.has(t.code)} onChange={() => toggle(t.code)} className="h-4 w-4 accent-brand-indigo" />
                  <span className="font-medium">{t.code_display}</span>
                  <span className="font-mono text-[11px] text-ink-faint">{t.code}</span>
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={addSelected}
            disabled={busy || selected.size === 0}
            className="mt-3 px-4 py-2 rounded-full bg-grad-accent text-white text-sm font-semibold shadow-pill hover:brightness-110 disabled:opacity-50 transition-all"
          >
            {busy ? "Adding…" : `Add selected (${selected.size})`}
          </button>
        </div>
      )}

      {/* Silence used to be the only signal that nothing matched: the header claimed the
          assessment "was analyzed automatically" and the space below it stayed empty, so a
          clinician could not tell a wording gap from a broken step. Say which it is. */}
      {assessment && candidates.length === 0 && didYouMean.length === 0 && (
        <p className="text-sm text-ink-soft">
          Nothing in the assessment matched the coded vocabulary, so there is nothing to suggest
          from it. That is a wording gap rather than a failure — rephrase the assessment, or search
          the vocabulary above for the term itself.
        </p>
      )}
      {assessment && candidates.length === 0 && didYouMean.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-soft">Closest vocabulary terms for the assessment wording:</span>
          {didYouMean.map((t) => (
            <span key={t.code} className="text-xs px-2.5 py-1 rounded-full border border-line bg-white text-ink-deep">
              {t.code_display}
            </span>
          ))}
          <span className="text-[11px] text-ink-faint">— add via the Diagnosis card if clinically intended.</span>
        </div>
      )}

      {/* Nothing to decide. The runbook says this stage is "usually nothing to add", and until now
          the only thing it said was "nothing matched" — which reads like a failure and, worse, sent
          the clinician to another surface to finish a step they were standing in. When the note
          raises nothing the vocabulary knows AND the problem list already carries this patient's
          diagnoses, say that and offer the way on. */}
      {assessment && candidates.length === 0 && documented.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-xl border border-status-ok-line bg-status-ok-bg px-3 py-2"
          data-testid="diagnose-nothing-to-do"
        >
          <span className="text-sm text-status-ok">
            Nothing to add — the problem list already carries this patient&apos;s diagnoses, and this
            note raises none that are missing from it.
          </span>
          {onAdvance && (
            <button
              type="button"
              onClick={onAdvance}
              className="ml-auto px-3 py-1.5 rounded-full border border-status-ok-line bg-white text-sm font-semibold text-ink hover:bg-mist transition-colors"
            >
              Continue to Order →
            </button>
          )}
        </div>
      )}

      {!assessment && (
        <p className="text-sm text-status-pend bg-status-pend-bg border border-status-pend-line rounded-xl px-3 py-2">
          No SOAP draft found for this encounter — record in stage 1, or manage diagnoses from the Diagnosis card.
        </p>
      )}

      {msg && <p className="text-sm text-status-ok" data-testid="diagnose-msg">{msg}</p>}
      {error && <p className="text-sm text-status-rej" role="alert">{error}</p>}
    </section>
  );
}
