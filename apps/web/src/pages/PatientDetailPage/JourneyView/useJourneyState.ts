/**
 * useJourneyState — stage machine for the Encounter Journey wizard.
 *
 * Five stages, free navigation (clinicians may jump back and forth), with
 * the active stage persisted per patient in sessionStorage so a refresh
 * resumes exactly where the encounter left off. Stage completion is
 * reported by the stages themselves from their live data — never guessed.
 */

import { useCallback, useEffect, useState } from "react";

export const JOURNEY_STAGES = ["document", "diagnose", "order", "codelink", "submit"] as const;
export type JourneyStage = (typeof JOURNEY_STAGES)[number];

const KEY = (patientId: string): string => `journey.stage.${patientId}`;

interface JourneyState {
  readonly stage: JourneyStage;
  readonly setStage: (stage: JourneyStage) => void;
  /** Stages whose completion condition currently holds (from live data). */
  readonly completed: ReadonlySet<JourneyStage>;
  readonly markCompleted: (stage: JourneyStage, done: boolean) => void;
}

export function useJourneyState(patientId: string): JourneyState {
  const [stage, setStageState] = useState<JourneyStage>(() => {
    try {
      const saved = sessionStorage.getItem(KEY(patientId)) as JourneyStage | null;
      if (saved && (JOURNEY_STAGES as readonly string[]).includes(saved)) return saved;
    } catch {
      /* storage blocked — start at the first stage */
    }
    return "document";
  });
  const [completed, setCompleted] = useState<ReadonlySet<JourneyStage>>(new Set());

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY(patientId), stage);
    } catch {
      /* storage blocked — resume simply won't persist */
    }
  }, [patientId, stage]);

  const setStage = useCallback((next: JourneyStage) => setStageState(next), []);

  const markCompleted = useCallback((id: JourneyStage, done: boolean) => {
    setCompleted((prev) => {
      // Bail out on no-op: stage components pass inline callbacks whose
      // identity changes every render, so their completion effects re-run
      // often — returning the same Set lets React skip the re-render and
      // stops the render/effect cycle from looping.
      if (prev.has(id) === done) return prev;
      const next = new Set(prev);
      if (done) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  return { stage, setStage, completed, markCompleted };
}
