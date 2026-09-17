/**
 * Stage 1 — Document. Record (live mic or demo playback); the SOAP note
 * drafts itself from the transcript (existing debounced generation) and
 * the clinician edits the final word. Completion = any note content.
 *
 * C10 (readiness assessment): the reviewed note now persists to the
 * record. When the SOAP has content, a "Save note to record" button
 * creates a SOAP draft via the existing drafts API — the note becomes
 * reachable from later journey stages and the patient's record, not
 * just the browser session.
 */

import { useCallback, useEffect, useState } from "react";
import { CortexProvider, useCortex } from "../../../components/layout/CortexContext";
import AmbientScribePane from "../../../components/layout/panes/AmbientScribePane";
import { api, type DocumentDraft, ApiError } from "../../../lib/api";

interface StageDocumentProps {
  readonly patientId: string;
  readonly onDone: (done: boolean) => void;
  /** Called once the reviewed note is in the record, so the journey can move
   * the clinician on to the next stage. */
  readonly onAdvance?: () => void;
}

function CompletionProbe({ onDone }: { readonly onDone: (done: boolean) => void }): null {
  const { soap } = useCortex();
  const hasNote = Boolean(soap.subjective.trim() || soap.objective.trim() || soap.assessment.trim() || soap.plan.trim());
  useEffect(() => {
    onDone(hasNote);
  }, [hasNote, onDone]);
  return null;
}

function SaveToRecord({ patientId, onSaved }: { readonly patientId: string; readonly onSaved?: (() => void) | undefined }): JSX.Element | null {
  const { soap, transcript } = useCortex();
  const [saved, setSaved] = useState<DocumentDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasNote = Boolean(soap.subjective.trim() || soap.objective.trim() || soap.assessment.trim() || soap.plan.trim());

  const save = useCallback((): void => {
    if (!hasNote || busy) return;
    setBusy(true); setError(null);
    const transcriptText = transcript.map((l) => `${l.speaker}: ${l.text}`).join("\n");
    api.patients
      .createDraft(patientId, "encounter_note", "en", "general", {
        transcript: transcriptText,
        sections: [],
        // The SOAP note as the clinician reviewed it. These are their words, not
        // a transcript extract, so they are sent as authored sections: a
        // restructured note is never a verbatim substring of the transcript, and
        // the containment gate rejected exactly that (400 on save) until this
        // path existed. Provenance is recorded per section and sign-off is still
        // required before the draft becomes documentation.
        authoredSections: [
          { key: "subjective", text: soap.subjective },
          { key: "objective", text: soap.objective },
          { key: "assessment", text: soap.assessment },
          { key: "plan", text: soap.plan },
        ].filter((s) => s.text.trim().length > 0),
      })
      .then((draft) => {
        setSaved(draft);
        onSaved?.();
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to save note"))
      .finally(() => setBusy(false));
  }, [patientId, soap, transcript, hasNote, busy, onSaved]);

  if (!hasNote) return null;

  if (saved) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-status-ok-line bg-status-ok-bg px-3 py-2" data-testid="note-saved">
        <span className="text-sm font-semibold text-status-ok">✓ Note saved to record</span>
        <span className="text-xs text-ink-soft">
          Draft {saved.id.slice(0, 8)} — review and sign from the Drafts card.
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={save}
        disabled={busy}
        data-testid="save-note-to-record"
        className="px-4 py-2 rounded-full bg-grad-accent text-white text-sm font-semibold shadow-pill hover:brightness-110 disabled:opacity-50 transition-all"
      >
        {busy ? "Saving…" : "Save note to record"}
      </button>
      <span className="text-[11px] text-ink-faint">
        Creates a draft in the patient&apos;s record — review and sign before it becomes clinical documentation.
      </span>
      {error && <span className="text-xs text-status-rej" role="alert">{error}</span>}
    </div>
  );
}

export default function StageDocument({ patientId, onDone, onAdvance }: StageDocumentProps): JSX.Element {
  return (
    <section aria-label="Stage: Document" data-testid="journey-stage-panel-document" className="space-y-3">
      <header>
        <h2 className="text-lg font-bold text-ink">1 · Document the encounter</h2>
        <p className="text-sm text-ink-soft">
          Record (or play the demo transcript) — the SOAP note drafts itself as you speak. Edit any field; your edits are final and survive regeneration.
        </p>
      </header>
      {/* ONE CortexProvider wraps everything: the scribe pane, the
          completion probe, AND the save-to-record button all share the
          same SOAP/transcript state. A second provider here would create
          an isolated context whose SOAP is always empty. */}
      <CortexProvider patientId={patientId} autoStream>
        <div className="rounded-2xl border border-line overflow-hidden h-[480px] bg-wash">
          <CompletionProbe onDone={onDone} />
          <AmbientScribePane />
        </div>
        <SaveToRecord patientId={patientId} onSaved={onAdvance} />
      </CortexProvider>
    </section>
  );
}
