/**
 * CortexShell — the 3-pane clinical encounter shell.
 *
 *   Left   — Ambient Scribe & live SOAP note (fixed width)
 *   Center — Patient master timeline & clinical order entry (flexes)
 *   Right  — Collapsible "AI Team" agent drawer
 *
 * Collapsing the right drawer hands its width to the center column; the
 * width transition is animated on the drawer container.
 *
 * This shell is an ADDITIONAL patient view. It does not replace the Copilot
 * workspace or the Patient File chart view, both of which remain reachable
 * from the sidebar.
 */

import { useEffect, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { CortexProvider } from "./CortexContext";
import AmbientScribePane from "./panes/AmbientScribePane";
import TimelinePane from "./panes/TimelinePane";
import AiTeamDrawer from "./panes/AiTeamDrawer";
import { useCortex } from "./CortexContext";

interface CortexShellProps {
  readonly patientName?: string | undefined;
  /** Real patient ID to ground the AI Team agents in via NSCRE (Sprint 8).
   * Omitted keeps the shell in its existing demo/mock mode -- see
   * CortexProvider's patientId doc comment. */
  readonly patientId?: string | null | undefined;
  /** Real encounter to submit NPHIES pre-authorizations against (Sprint 9).
   * Without it the pre-auth modal explains that the shell is in demo mode
   * rather than fabricating a payer response. */
  readonly encounterId?: string | null | undefined;
  /** Disable the simulated transcript timer (tests / stories). */
  readonly autoStream?: boolean;
}

/** Inner layout — needs to be under the provider to read drawer state. */
/** Drag-to-resize for the shell's panes.
 *
 * The audit filed these as "fixed 340/320 panes, no resize": a clinician whose
 * patient name is long, or who is reading a wide order table, had no way to give
 * either pane more room. Pointer drag *and* arrow keys -- a resize that only a
 * mouse can perform is a keyboard trap -- and the width is remembered per pane.
 */
function usePaneWidth(
  storageKey: string,
  initial: number,
  min: number,
  max: number,
  direction: 1 | -1,
): {
  readonly width: number;
  readonly onPointerDown: (e: ReactPointerEvent) => void;
  readonly onKeyDown: (e: ReactKeyboardEvent) => void;
  readonly dragging: boolean;
} {
  const read = (): number => {
    if (typeof window === "undefined") return initial;
    const stored = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored >= min && stored <= max ? stored : initial;
  };
  const [width, setWidth] = useState<number>(read);
  const [dragging, setDragging] = useState<boolean>(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(width));
    } catch {
      /* private browsing: the layout simply does not persist */
    }
  }, [storageKey, width]);

  const onPointerDown = (event: ReactPointerEvent): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const move = (e: PointerEvent): void => {
      setWidth(Math.min(max, Math.max(min, startWidth + direction * (e.clientX - startX))));
    };
    const stop = (): void => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    setDragging(true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const onKeyDown = (event: ReactKeyboardEvent): void => {
    const step = event.shiftKey ? 40 : 10;
    if (event.key === "ArrowRight") setWidth((w) => Math.min(max, w + direction * step));
    else if (event.key === "ArrowLeft") setWidth((w) => Math.max(min, w - direction * step));
    else return;
    event.preventDefault();
  };

  return { width, onPointerDown, onKeyDown, dragging };
}

function ResizeHandle({
  width,
  min,
  max,
  label,
  dragging,
  onPointerDown,
  onKeyDown,
}: {
  readonly width: number;
  readonly min: number;
  readonly max: number;
  readonly label: string;
  readonly dragging: boolean;
  readonly onPointerDown: (e: ReactPointerEvent) => void;
  readonly onKeyDown: (e: ReactKeyboardEvent) => void;
}): JSX.Element {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={`w-1 shrink-0 cursor-col-resize transition-colors ${
        dragging ? "bg-brand-indigo/60" : "bg-line hover:bg-brand-indigo/40"
      }`}
    />
  );
}

/** Inner layout — needs to be under the provider to read drawer state. */
function ShellLayout({ patientName }: { readonly patientName?: string | undefined }): JSX.Element {
  const { drawerOpen } = useCortex();
  const { t } = useTranslation();
  const scribe = usePaneWidth("cortex.pane.scribe", 340, 260, 560, 1);
  const team = usePaneWidth("cortex.pane.team", 320, 240, 520, -1);

  return (
    <div className="flex h-full w-full overflow-hidden rounded-2xl border border-line bg-white shadow-card">
      {/* Left — ambient scribe */}
      <div className="hidden shrink-0 border-e border-line lg:block" style={{ width: scribe.width }}>
        <AmbientScribePane />
      </div>
      <div className="hidden lg:block">
        <ResizeHandle
          width={scribe.width}
          min={260}
          max={560}
          label={t("shell.resizeScribe", { defaultValue: "Resize the scribe pane" })}
          dragging={scribe.dragging}
          onPointerDown={scribe.onPointerDown}
          onKeyDown={scribe.onKeyDown}
        />
      </div>

      {/* Center — timeline + orders */}
      <div className="min-w-0 flex-1">
        {patientName && (
          <div className="border-b border-line bg-wash px-5 py-2.5">
            <p className="text-xs text-ink-soft">
              {t("shell.encounterView", { defaultValue: "Encounter view" })} ·{" "}
              <span className="text-ink-deep">{patientName}</span>
            </p>
          </div>
        )}
        <TimelinePane />
      </div>

      {/* Right — AI team drawer (width animates on collapse, and is resizable when open) */}
      <ResizeHandle
        width={team.width}
        min={240}
        max={520}
        label={t("shell.resizeTeam", { defaultValue: "Resize the AI team pane" })}
        dragging={team.dragging}
        onPointerDown={team.onPointerDown}
        onKeyDown={team.onKeyDown}
      />
      <div
        className="shrink-0 transition-[width] duration-200 ease-in-out"
        style={{ width: drawerOpen ? team.width : 48 }}
      >
        <AiTeamDrawer />
      </div>
    </div>
  );
}

export default function CortexShell({
  patientName,
  patientId = null,
  encounterId = null,
  autoStream = true,
}: CortexShellProps): JSX.Element {
  return (
    <CortexProvider autoStream={autoStream} patientId={patientId} encounterId={encounterId}>
      <ShellLayout patientName={patientName} />
    </CortexProvider>
  );
}
