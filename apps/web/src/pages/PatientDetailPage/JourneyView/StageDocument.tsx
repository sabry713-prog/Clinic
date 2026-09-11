/**
 * Stage 1 — Document. Record (live mic or demo playback); the SOAP note
 * drafts itself from the transcript (existing debounced generation) and
 * the clinician edits the final word. Completion = any note content.
 */

import { useEffect } from "react";
import { SullyProvider, useSully } from "../../../components/layout/SullyContext";
import AmbientScribePane from "../../../components/layout/panes/AmbientScribePane";

interface StageDocumentProps {
  readonly patientId: string;
  readonly onDone: (done: boolean) => void;
}

function CompletionProbe({ onDone }: { readonly onDone: (done: boolean) => void }): null {
  const { soap } = useSully();
  const hasNote = Boolean(soap.subjective.trim() || soap.objective.trim() || soap.assessment.trim() || soap.plan.trim());
  useEffect(() => {
    onDone(hasNote);
  }, [hasNote, onDone]);
  return null;
}

export default function StageDocument({ patientId, onDone }: StageDocumentProps): JSX.Element {
  return (
    <section aria-label="Stage: Document" data-testid="journey-stage-panel-document" className="space-y-3">
      <header>
        <h2 className="text-lg font-bold text-ink">1 · Document the encounter</h2>
        <p className="text-sm text-ink-soft">
          Record (or play the demo transcript) — the SOAP note drafts itself as you speak. Edit any field; your edits are final and survive regeneration.
        </p>
      </header>
      <div className="rounded-2xl border border-line overflow-hidden h-[480px] bg-wash">
        <SullyProvider patientId={patientId} autoStream>
          <CompletionProbe onDone={onDone} />
          <AmbientScribePane />
        </SullyProvider>
      </div>
    </section>
  );
}
