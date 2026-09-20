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

import { useCallback, useEffect, useMemo, useState } from "react";
import { CortexProvider, useCortex } from "../../../components/layout/CortexContext";
import AmbientScribePane from "../../../components/layout/panes/AmbientScribePane";
import AiTeamDrawer from "../../../components/layout/panes/AiTeamDrawer";
import { api, ApiError } from "../../../lib/api";

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

/**
 * The working copy of the note, saved as the clinician edits.
 *
 * This was a button ("Save note to record") that created a NEW draft on every press, which meant the
 * note only reached the record when someone remembered to press it — and a second press duplicated it.
 * Item 2 of the consolidation plan makes it automatic: the note is persisted as it is written, and the
 * clinician's only remaining explicit act is signing, which still happens through the drafts flow.
 *
 * Guardrail (CLAUDE.md §2): a draft is not documentation. Nothing here signs anything, the status says
 * so in as many words, and sign-off remains an explicit clinician act.
 *
 * The draft is located the same way stage 2 locates it — the newest encounter_note for the patient,
 * since app.document_draft has no encounter column. One open note per patient is the assumption; a
 * draft.encounter_id is the real fix and is recorded in the assessment.
 */
function AutoSaveNote({ patientId, onAdvance }: { readonly patientId: string; readonly onAdvance?: (() => void) | undefined }): JSX.Element | null {
  const { soap, transcript } = useCortex();
  const [draftId, setDraftId] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const hasNote = Boolean(
    soap.subjective.trim() || soap.objective.trim() || soap.assessment.trim() || soap.plan.trim(),
  );

  // Always all four, including empties: clearing a field must clear its section rather than leave the
  // previous text behind in the copy the later stages read.
  const sections = useMemo(
    () => [
      { key: "subjective", text: soap.subjective },
      { key: "objective", text: soap.objective },
      { key: "assessment", text: soap.assessment },
      { key: "plan", text: soap.plan },
    ],
    [soap.subjective, soap.objective, soap.assessment, soap.plan],
  );

  const save = useCallback(async (): Promise<void> => {
    if (!hasNote || saving) return;
    setSaving(true);
    setError(null);
    try {
      let id = draftId;
      if (id == null) {
        const list = await api.patients.listDrafts(patientId);
        const existing = (list.data ?? [])
          .filter((d) => d.document_type === "encounter_note" && d.status === "draft")
          .slice()
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
        id = existing ? existing.id : null;
      }
      if (id != null) {
        await api.drafts.updateSections(id, sections);
      } else {
        const transcriptText = transcript.map((l) => `${l.speaker}: ${l.text}`).join("\n");
        const created = await api.patients.createDraft(patientId, "encounter_note", "en", "general", {
          transcript: transcriptText,
          sections: [],
          // The clinician's own words rather than a transcript extract, so they are authored sections:
          // a restructured note is never a verbatim substring of a transcript, and with no recording
          // (a patient may decline) there is no transcript at all. Provenance is recorded per section.
          authoredSections: sections.filter((s) => s.text.trim().length > 0),
        });
        id = created.id;
      }
      setDraftId(id);
      setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the working copy");
    } finally {
      setSaving(false);
    }
  }, [patientId, sections, transcript, hasNote, saving, draftId]);

  useEffect(() => {
    if (!hasNote) return;
    const timer = setTimeout(() => {
      void save();
    }, 2_500);
    return () => clearTimeout(timer);
  }, [save, hasNote]);

  if (!hasNote) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white px-3 py-2"
      data-testid="note-autosave"
    >
      <span className="text-sm text-ink-soft">
        {saving
          ? "Saving the working copy…"
          : savedAt
            ? `Working copy saved ${savedAt} — not signed.`
            : "The note saves itself as you write."}
      </span>
      {savedAt && (
        <span className="text-[11px] text-ink-faint">
          It is a draft until a clinician signs it; signing is the explicit act that makes it
          documentation.
        </span>
      )}
      {error && (
        <span className="text-xs text-status-rej" role="alert">
          {error}
        </span>
      )}
      {savedAt && onAdvance && (
        <button
          type="button"
          onClick={onAdvance}
          className="ml-auto px-3 py-1.5 rounded-full border border-line bg-white text-sm font-semibold text-ink hover:bg-mist transition-colors"
        >
          Continue to Diagnose →
        </button>
      )}
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
        <div className="flex gap-3">
          <div className="rounded-2xl border border-line overflow-hidden h-[480px] flex-1 min-w-0 bg-wash">
            <CompletionProbe onDone={onDone} />
            <AmbientScribePane />
          </div>
          {/* G5: the AI Team used to be reachable only from the old three-pane shell, so consulting an
              agent meant leaving the journey and carrying the encounter with it. It is a collapsible
              drawer rather than a stage — the agents are situational, and per the review the only
              requirement is that they open without losing the encounter. The drawer manages its own
              collapsed rail, so nothing here decides whether it is open. */}
          <div className="h-[480px] shrink-0">
            <AiTeamDrawer />
          </div>
        </div>
        <AutoSaveNote patientId={patientId} onAdvance={onAdvance} />
      </CortexProvider>
    </section>
  );
}
