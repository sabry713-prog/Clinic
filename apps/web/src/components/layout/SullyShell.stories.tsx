/**
 * Storybook catalog for the 3-pane clinical shell.
 *
 * All state is mock (SullyContext). `autoStream` controls whether the
 * simulated transcript ticks on a timer.
 */

import type { Meta, StoryObj } from "@storybook/react";
import SullyShell from "./SullyShell";
import NphiesBadge from "./NphiesBadge";
import { SullyProvider } from "./SullyContext";
import AmbientScribePane from "./panes/AmbientScribePane";
import TimelinePane from "./panes/TimelinePane";
import AiTeamDrawer from "./panes/AiTeamDrawer";

const meta: Meta<typeof SullyShell> = {
  title: "Layout/SullyShell",
  component: SullyShell,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof SullyShell>;

/** Full 3-pane shell. Press Record in the left pane to stream the transcript. */
export const FullShell: Story = {
  args: { patientName: "Test Patient Alpha", autoStream: true },
  render: (args) => (
    <div className="min-h-screen bg-slate-950 p-4 text-white">
      <SullyShell {...args} />
    </div>
  ),
};

/** Static variant — no timer, useful for visual review. */
export const StaticNoStreaming: Story = {
  args: { patientName: "Test Patient Alpha", autoStream: false },
  render: (args) => (
    <div className="min-h-screen bg-slate-950 p-4 text-white">
      <SullyShell {...args} />
    </div>
  ),
};

// ---------------------------------------------------------------- panes
function PaneFrame({ children, width }: { children: React.ReactNode; width: string }): JSX.Element {
  return (
    <div className="min-h-screen bg-slate-950 p-4 text-white">
      <div className={`${width} h-[80vh] overflow-hidden rounded-xl border border-slate-800`}>
        <SullyProvider autoStream={false}>{children}</SullyProvider>
      </div>
    </div>
  );
}

export const LeftPane_AmbientScribe: StoryObj = {
  name: "Panes / Left — Ambient Scribe",
  render: () => <PaneFrame width="w-[360px]"><AmbientScribePane /></PaneFrame>,
};

export const CenterPane_Timeline: StoryObj = {
  name: "Panes / Center — Timeline & Orders",
  render: () => <PaneFrame width="w-[720px]"><TimelinePane /></PaneFrame>,
};

export const RightPane_AiTeam: StoryObj = {
  name: "Panes / Right — AI Team Drawer",
  render: () => <PaneFrame width="w-[320px]"><AiTeamDrawer /></PaneFrame>,
};

// ---------------------------------------------------------------- badges
export const NphiesBadges: StoryObj = {
  name: "NPHIES status badges",
  render: () => (
    <div className="min-h-screen space-y-6 bg-slate-950 p-8 text-white">
      <p className="text-xs text-slate-400">
        Badge colour reflects billing / claim state only — never clinical severity.
        Hover or click a badge for its tooltip.
      </p>
      <div className="flex flex-col items-start gap-6">
        <NphiesBadge
          status="green"
          detail="Approved / covered — NPHIES code matched to documented diagnosis I10."
        />
        <NphiesBadge
          status="yellow"
          detail="Pre-authorisation required by the payer before this service can be claimed."
          actionLabel="Submit Pre-Auth"
          onAction={() => undefined}
        />
        <NphiesBadge
          status="red"
          detail="Code mismatch — no recorded necessity rule links this procedure to the documented diagnoses."
          suggestedCodes={["38300-00-10", "38306-00-10"]}
          actionLabel="Apply suggested code"
          onAction={() => undefined}
        />
      </div>
    </div>
  ),
};
