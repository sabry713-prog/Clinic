/**
 * ShowMore — generic "show the first N items, expand for the rest" helper.
 *
 * Purely presentational truncation: items keep their source order and the
 * hidden remainder is never filtered, ranked, or summarized.
 */

import { useState } from "react";

export interface ShowMoreState<T> {
  readonly visible: readonly T[];
  readonly expanded: boolean;
  readonly hiddenCount: number;
  readonly toggle: () => void;
}

export function useShowMore<T>(
  items: readonly T[],
  initialCount: number,
): ShowMoreState<T> {
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? items : items.slice(0, initialCount);
  const hiddenCount = Math.max(0, items.length - initialCount);

  return {
    visible,
    expanded,
    hiddenCount,
    toggle: () => setExpanded((e) => !e),
  };
}

interface ShowMoreButtonProps {
  readonly state: ShowMoreState<unknown>;
  readonly itemLabel: string; // e.g. "conditions", "observations"
}

export function ShowMoreButton({
  state,
  itemLabel,
}: ShowMoreButtonProps): JSX.Element | null {
  if (state.hiddenCount === 0) return null;

  return (
    <button
      type="button"
      onClick={state.toggle}
      aria-expanded={state.expanded}
      className="mt-2 inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold text-ink-soft hover:text-ink hover:border-line-strong transition-colors"
    >
      {state.expanded
        ? "Show fewer"
        : `Show ${state.hiddenCount} more ${itemLabel}`}
    </button>
  );
}
