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
  /** The encounter this note belongs to — the key for its provenance (how it was captured) and for
   *  the checklist decisions that ride on the same encounter. */
  readonly encounterId?: string | null;
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
function AutoSaveNote({ patientId, encounterId, onAdvance }: { readonly patientId: string; readonly encounterId?: string | null | undefined; readonly onAdvance?: (() => void) | undefined }): JSX.Element | null {
  const { soap, transcript } = useCortex();
  const [draftId, setDraftId] = useState<string | null>(null);
  // The refusal. Everything else about how the note was captured can be derived: a transcript means
  // ambient capture, none means it was written. Only the patient's reason has to be asked for — the
  // system cannot infer it, and inventing it would put a refusal in the record that never happened.
  const [declined, setDeclined] = useState(false);
  // Signing is the one act this stage must not make easy to do by accident, and must not do itself.
  // The drafts flow already had the right shape — persist, THEN freeze — so it is reused verbatim.
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
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
      // Record the mechanism with no one pressing anything: a transcript means the ambient capture
      // produced the note, and no transcript means it was written. The refusal is the only part that
      // had to be asked (the checkbox below), and it is carried through here.
      if (encounterId) {
        void api.patients
          .setDocumentation(patientId, encounterId, transcript.length > 0 ? "ambient" : "manual", declined)
          .catch(() => {
            /* provenance, not the note: a lost write must not undo the save that just succeeded */
          });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the working copy");
    } finally {
      setSaving(false);
    }
  }, [patientId, encounterId, sections, transcript, hasNote, saving, draftId, declined]);

  const signNote = useCallback(async (): Promise<void> => {
    if (draftId == null || signing || signedAt) return;
    setSigning(true);
    setError(null);
    try {
      // Persist what is on screen, then freeze it — the same order the drafts panel uses, so signing
      // can never freeze a stale copy. The service refuses to edit a signed draft afterwards, which is
      // why the auto-save below stops rather than retrying into an error.
      await api.drafts.updateSections(draftId, sections);
      const out = await api.drafts.sign(draftId);
      setSignedAt(out.signed_at ?? new Date().toISOString());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not sign the note");
    } finally {
      setSigning(false);
    }
  }, [draftId, sections, signing, signedAt]);

  useEffect(() => {
    // A signed note is frozen: nothing more to save, and the service would refuse anyway.
    if (!hasNote || signedAt) return;
    const timer = setTimeout(() => {
      void save();
    }, 2_500);
    return () => clearTimeout(timer);
  }, [save, hasNote, signedAt]);

  if (!hasNote) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white px-3 py-2"
      data-testid="note-autosave"
    >
      <span className="text-sm text-ink-soft">
        {signedAt
          ? "Signed — the auto-save has stopped and the note is frozen."
          : saving
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
      <label className="flex items-center gap-1.5 text-xs text-ink-soft">
        <input
          type="checkbox"
          checked={declined}
          disabled={!encounterId}
          onChange={(e) => {
            const next = e.target.checked;
            setDeclined(next);
            if (encounterId) {
              void api.patients
                .setDocumentation(patientId, encounterId, transcript.length > 0 ? "ambient" : "manual", next)
                .catch(() => {
                  /* provenance only — the note is unaffected */
                });
            }
          }}
          className="h-3.5 w-3.5 accent-brand-indigo"
          data-testid="recording-declined"
        />
        Patient declined recording — the note is written by hand
      </label>
      {error && (
        <span className="text-xs text-status-rej" role="alert">
          {error}
        </span>
      )}
      {savedAt && !signedAt && (
        <button
          type="button"
          onClick={() => void signNote()}
          disabled={signing || draftId == null}
          data-testid="sign-note"
          className="px-3 py-1.5 rounded-full bg-grad-accent text-white text-sm font-semibold shadow-pill hover:brightness-110 disabled:opacity-50 transition-all"
        >
          {signing ? "Signing…" : "Sign the note"}
        </button>
      )}
      {signedAt && (
        <span className="text-sm font-semibold text-status-ok" data-testid="note-signed">
          ✓ Signed {new Date(signedAt).toLocaleString("en-GB")} — this is the note of record.
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

export default function StageDocument({ patientId, encounterId, onDone, onAdvance }: StageDocumentProps): JSX.Element {
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
        <AutoSaveNote patientId={patientId} encounterId={encounterId} onAdvance={onAdvance} />
      </CortexProvider>
    </section>
  );
}
