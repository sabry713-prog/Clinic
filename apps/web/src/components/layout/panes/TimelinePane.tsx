/**
 * Center column — Patient Master Timeline + Clinical Order Entry.
 *
 * The timeline reproduces documented encounters, labs, notes, medications and
 * imaging in reverse-chronological order. The order entry panel lists order
 * lines with their NPHIES claim status; the badge colour is billing state,
 * not clinical severity.
 */

import {
  Stethoscope, FlaskConical, FileText, Pill, ScanLine,
  Beaker, Syringe, Scissors, Plus,
} from "lucide-react";
import { useSully, type OrderCategory, type TimelineEntry } from "../SullyContext";
import NphiesBadge from "../NphiesBadge";

const TIMELINE_ICONS: Record<TimelineEntry["kind"], typeof Stethoscope> = {
  encounter: Stethoscope,
  lab: FlaskConical,
  note: FileText,
  medication: Pill,
  imaging: ScanLine,
};

const ORDER_CATEGORIES: readonly { id: OrderCategory; label: string; icon: typeof Beaker }[] = [
  { id: "medication", label: "Medications", icon: Pill },
  { id: "lab", label: "Labs", icon: Beaker },
  { id: "imaging", label: "Imaging", icon: ScanLine },
  { id: "procedure", label: "Procedures", icon: Scissors },
];

const CATEGORY_ICONS: Record<OrderCategory, typeof Beaker> = {
  medication: Pill,
  lab: Beaker,
  imaging: ScanLine,
  procedure: Syringe,
};

export default function TimelinePane(): JSX.Element {
  const { timeline, orders, runAgentAction } = useSully();

  return (
    <section className="flex h-full flex-col overflow-y-auto bg-slate-950" aria-label="Patient timeline and orders">
      {/* Master timeline */}
      <div className="border-b border-slate-800 p-5">
        <h2 className="mb-3 text-sm font-semibold text-white">Patient master timeline</h2>
        <ol className="relative space-y-3 border-s border-slate-800 ps-5">
          {timeline.map((entry) => {
            const Icon = TIMELINE_ICONS[entry.kind];
            return (
              <li key={entry.id} className="relative">
                <span className="absolute -start-[27px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-800 ring-4 ring-slate-950">
                  <Icon className="h-2.5 w-2.5 text-slate-300" aria-hidden="true" />
                </span>
                <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-xs font-medium text-slate-100">{entry.title}</p>
                    <time className="shrink-0 font-mono text-[11px] text-slate-500">{entry.at}</time>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">{entry.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Order entry */}
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Clinical order entry</h2>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
          >
            <Plus className="h-3.5 w-3.5" /> New order
          </button>
        </div>

        {/* Category selector */}
        <div className="mb-3 flex flex-wrap gap-2">
          {ORDER_CATEGORIES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300 hover:border-slate-600 hover:text-white"
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        {/* Order lines */}
        <ul className="space-y-2">
          {orders.map((order) => {
            const Icon = CATEGORY_ICONS[order.category];
            const needsAction = order.nphiesStatus !== "green";
            const actionLabel =
              order.nphiesStatus === "yellow" ? "Submit Pre-Auth" : "Apply suggested code";
            return (
              <li
                key={order.id}
                className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2.5"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-100">{order.display}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                    {order.codeSystem} {order.code}
                  </p>
                </div>
                <NphiesBadge
                  status={order.nphiesStatus}
                  detail={order.nphiesDetail}
                  suggestedCodes={order.suggestedCodes}
                  actionLabel={needsAction ? actionLabel : undefined}
                  onAction={
                    needsAction
                      ? () => runAgentAction({ id: `order-${order.id}`, label: actionLabel, description: order.display })
                      : undefined
                  }
                />
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
