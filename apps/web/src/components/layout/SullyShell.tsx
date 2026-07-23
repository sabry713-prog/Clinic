/**
 * SullyShell — the 3-pane clinical encounter shell.
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

import { SullyProvider } from "./SullyContext";
import AmbientScribePane from "./panes/AmbientScribePane";
import TimelinePane from "./panes/TimelinePane";
import AiTeamDrawer from "./panes/AiTeamDrawer";
import { useSully } from "./SullyContext";

interface SullyShellProps {
  readonly patientName?: string | undefined;
  /** Disable the simulated transcript timer (tests / stories). */
  readonly autoStream?: boolean;
}

/** Inner layout — needs to be under the provider to read drawer state. */
function ShellLayout({ patientName }: { readonly patientName?: string | undefined }): JSX.Element {
  const { drawerOpen } = useSully();

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden rounded-xl border border-slate-800">
      {/* Left — ambient scribe */}
      <div className="hidden w-[340px] shrink-0 border-e border-slate-800 lg:block">
        <AmbientScribePane />
      </div>

      {/* Center — timeline + orders */}
      <div className="min-w-0 flex-1">
        {patientName && (
          <div className="border-b border-slate-800 bg-slate-950 px-5 py-2.5">
            <p className="text-xs text-slate-400">
              Encounter view · <span className="text-slate-200">{patientName}</span>
            </p>
          </div>
        )}
        <TimelinePane />
      </div>

      {/* Right — AI team drawer (width animates on collapse) */}
      <div
        className={`shrink-0 transition-[width] duration-200 ease-in-out ${
          drawerOpen ? "w-[320px]" : "w-12"
        }`}
      >
        <AiTeamDrawer />
      </div>
    </div>
  );
}

export default function SullyShell({ patientName, autoStream = true }: SullyShellProps): JSX.Element {
  return (
    <SullyProvider autoStream={autoStream}>
      <ShellLayout patientName={patientName} />
    </SullyProvider>
  );
}
