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
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSully, type OrderCategory, type OrderLine, type TimelineEntry } from "../SullyContext";
import NphiesBadge from "../NphiesBadge";
import PreAuthModal, { type PreAuthFields } from "../../timeline/PreAuthModal";

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
  const { timeline, timelineLoading, timelineError, orders, soap, runAgentAction, submitPreAuth } = useSully();
  const [preAuthOrder, setPreAuthOrder] = useState<OrderLine | null>(null);
  const [, setSearchParams] = useSearchParams();

  // Category chips filter the order list (audit M-5 -- they previously had no
  // handler at all). Clicking an active chip clears the filter.
  const [categoryFilter, setCategoryFilter] = useState<OrderCategory | null>(null);
  const visibleOrders = useMemo(
    () => (categoryFilter ? orders.filter((o) => o.category === categoryFilter) : orders),
    [orders, categoryFilter],
  );

  /** "New order" opens the real order-entry flow (ServiceRequestPanel) in the
   * workspace view rather than duplicating it here -- that panel already owns
   * candidate lookup, SBS coding and the confirm step. */
  const openOrderEntry = (): void => setSearchParams({ view: "workspace", open: "orders" });

  const preAuthFields: PreAuthFields | null = preAuthOrder
    ? {
        orderId: preAuthOrder.id,
        // Displayed for transparency; the real encounter id is supplied by the
        // provider at submit time (the shell may be in demo mode).
        encounterId: "current encounter",
        orderDisplay: preAuthOrder.display,
        sbsCode: preAuthOrder.code,
        sbsDisplay: preAuthOrder.display,
        icd10Code: preAuthOrder.icd10Code ?? "—",
        icd10Display: preAuthOrder.icd10Display,
        clinicalDocument:
          [soap.subjective, soap.objective, soap.assessment, soap.plan]
            .filter(Boolean)
            .join("\n\n") || "No SOAP content captured for this encounter yet.",
      }
    : null;

  return (
    <section className="flex h-full flex-col overflow-y-auto bg-wash" aria-label="Patient timeline and orders">
      {/* Master timeline */}
      <div className="border-b border-line p-5">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink">Patient master timeline</h2>
          {timelineLoading && (
            <span className="text-[11px] text-ink-soft">loading…</span>
          )}
        </div>
        {timelineError && (
          <p role="status" className="mb-2 text-[11px] leading-relaxed text-status-pend">
            {timelineError}
          </p>
        )}
        <ol
          data-testid="timeline-feed"
          className="relative max-h-[22rem] space-y-3 overflow-y-auto ps-5 pe-1"
        >
          {/* Rail drawn INSIDE the padding box: the scroll container clips
              both axes, so dots hung on an outer border (the old border-s)
              were half-cut. Rail at 15px, dot centers at 15px. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-2 start-[15px] w-px bg-line"
          />
          {timeline.map((entry) => {
            const Icon = TIMELINE_ICONS[entry.kind];
            return (
              <li key={entry.id} className="relative">
                <span className="absolute -start-[13px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-veil ring-4 ring-line">
                  <Icon className="h-2.5 w-2.5 text-ink-deep" aria-hidden="true" />
                </span>
                <div className="rounded-lg border border-line bg-white px-3 py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-xs font-medium text-ink">{entry.title}</p>
                    <time className="shrink-0 font-mono text-[11px] text-ink-soft">{entry.at}</time>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-soft">{entry.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Order entry */}
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Clinical order entry</h2>
          <button
            type="button"
            onClick={openOrderEntry}
            title="Opens the full order-entry panel in the workspace view"
            className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-ink-deep hover:bg-veil"
          >
            <Plus className="h-3.5 w-3.5" /> New order
          </button>
        </div>

        {/* Category selector */}
        <div className="mb-3 flex flex-wrap gap-2">
          {ORDER_CATEGORIES.map(({ id, label, icon: Icon }) => {
            const active = categoryFilter === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => setCategoryFilter(active ? null : id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                  active
                    ? "border-transparent bg-grad-accent text-white shadow-pill"
                    : "border-line bg-white text-ink-deep hover:border-line-strong hover:text-ink"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            );
          })}
        </div>

        {/* Order lines */}
        <ul className="space-y-2">
          {visibleOrders.map((order) => {
            const Icon = CATEGORY_ICONS[order.category];
            const needsAction = order.nphiesStatus !== "green";
            const actionLabel =
              order.nphiesStatus === "yellow" ? "Submit Pre-Auth" : "Apply suggested code";
            return (
              <li
                key={order.id}
                className="flex items-start gap-3 rounded-lg border border-line bg-white px-3 py-2.5"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink">{order.display}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-soft">
                    {order.codeSystem} {order.code}
                  </p>
                </div>
                <NphiesBadge
                  status={order.nphiesStatus}
                  detail={order.nphiesDetail}
                  suggestedCodes={order.suggestedCodes}
                  evidenceChain={order.evidenceChain}
                  authorizationNumber={order.authorizationNumber}
                  submitting={order.submitting}
                  // Clicking a yellow badge opens the pre-auth flow directly --
                  // the "1-click" path in the spec.
                  onBadgeClick={
                    order.nphiesStatus === "yellow" ? () => setPreAuthOrder(order) : undefined
                  }
                  actionLabel={needsAction ? actionLabel : undefined}
                  onAction={
                    order.nphiesStatus === "yellow"
                      ? () => setPreAuthOrder(order)
                      : needsAction
                        ? () => runAgentAction({ id: `order-${order.id}`, label: actionLabel, description: order.display })
                        : undefined
                  }
                />
              </li>
            );
          })}
          {visibleOrders.length === 0 && (
            <li className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-ink-soft">
              No {categoryFilter} orders on this encounter.
            </li>
          )}
        </ul>
      </div>

      {preAuthFields && (
        <PreAuthModal
          fields={preAuthFields}
          onClose={() => setPreAuthOrder(null)}
          onSubmit={async (f) => {
            await submitPreAuth(f.orderId);
          }}
        />
      )}
    </section>
  );
}
