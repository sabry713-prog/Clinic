/**
 * CoderQueue — RCM batch review queue over claim-integrity findings (E3).
 *
 * Prototype: the queue lives in the apps/core process (in-memory), so it
 * clears on backend restart — durable storage is Phase Cert. Items are
 * administrative findings only (CLAUDE.md §2).
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type CoderQueueItem, type CoderQueueItemStatus, ApiError } from "../../lib/api";

const STATUS_STYLE: Record<CoderQueueItemStatus, { cls: string; key: string }> = {
  pending: { cls: "bg-ink-soft/15 text-ink-deep border-line-strong/30", key: "coderQueue.statusPending" },
  in_review: { cls: "bg-status-pend-bg text-status-pend border-status-pend-line", key: "coderQueue.statusInReview" },
  resolved: { cls: "bg-status-ok-bg text-status-ok border-status-ok-line", key: "coderQueue.statusResolved" },
};

function ItemRow({
  item,
  onClaim,
  onResolve,
  busy,
}: {
  readonly item: CoderQueueItem;
  readonly onClaim: (id: string) => void;
  readonly onResolve: (id: string, note: string) => void;
  readonly busy: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const [note, setNote] = useState("");
  const status = STATUS_STYLE[item.status];
  return (
    <tr className="border-t border-line align-top hover:bg-veil/60">
      <td className="px-3 py-2 font-mono text-xs text-ink-deep">{item.mrn ?? "—"}</td>
      <td className="px-3 py-2">
        <span className={`inline-block rounded border px-2 py-0.5 text-xs ${status.cls}`}>{t(status.key)}</span>
      </td>
      <td className="px-3 py-2 text-xs text-ink-deep font-mono">{t(`coderQueue.reason.${item.reason}`)}</td>
      <td className="px-3 py-2 text-xs text-ink-soft">
        <p>{item.detail}</p>
        {item.icd10_code && item.sbs_code && (
          <p className="font-mono mt-0.5">
            {item.icd10_code} → {item.sbs_code}
          </p>
        )}
        {item.resolved_note && (
          <p className="mt-1 text-status-ok/80">
            {t("coderQueue.resolvedNote")}: {item.resolved_note}
          </p>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-ink-soft">
        {item.status === "pending" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onClaim(item.item_id);
            }}
            className="text-ink-deep hover:text-ink underline disabled:opacity-50"
          >
            {t("coderQueue.claim")}
          </button>
        )}
        {item.status === "in_review" && (
          <div className="flex flex-col gap-1 min-w-[12rem]">
            <input
              type="text"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
              placeholder={t("coderQueue.notePlaceholder")}
              aria-label={t("coderQueue.notePlaceholder")}
              className="bg-veil border border-line rounded px-2 py-1 text-xs text-ink-deep focus:outline-none focus:border-line-strong"
            />
            <button
              type="button"
              disabled={busy || note.trim().length < 3}
              onClick={() => {
                onResolve(item.item_id, note.trim());
                setNote("");
              }}
              className="text-start text-status-ok hover:text-emerald-200 underline disabled:opacity-50"
            >
              {t("coderQueue.resolve")}
            </button>
          </div>
        )}
        {item.status === "resolved" && <span>—</span>}
      </td>
    </tr>
  );
}

export default function CoderQueue(): JSX.Element {
  const { t } = useTranslation();
  const [items, setItems] = useState<readonly CoderQueueItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.admin.listCoderQueue();
      setItems(result.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("coderQueue.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const claim = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await api.admin.claimCoderQueueItem(id);
        await load();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : t("coderQueue.errorGeneric"));
      } finally {
        setBusy(false);
      }
    },
    [load, t],
  );

  const resolve = useCallback(
    async (id: string, note: string) => {
      setBusy(true);
      try {
        await api.admin.resolveCoderQueueItem(id, note);
        await load();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : t("coderQueue.errorGeneric"));
      } finally {
        setBusy(false);
      }
    },
    [load, t],
  );

  const pending = items?.filter((i) => i.status === "pending").length ?? 0;

  return (
    <div className="bg-white border border-line rounded-2xl shadow-card p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink">{t("coderQueue.title")}</h2>
          <p className="text-xs text-ink-soft">{t("coderQueue.subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          {items !== null && (
            <span className="text-xs text-ink-soft">
              {t("coderQueue.pendingCount", { count: pending })}
            </span>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="text-sm px-3 py-1.5 rounded bg-white hover:bg-veil border border-line text-ink-deep disabled:opacity-50"
          >
            {t("coderQueue.refresh")}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-status-rej">{error}</p>}

      {items !== null && items.length === 0 && (
        <p className="text-sm text-ink-soft">{t("coderQueue.empty")}</p>
      )}

      {items !== null && items.length > 0 && (
        <div className="overflow-x-auto border border-line rounded">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-ink-soft bg-veil/60">
                <th className="px-3 py-2 text-start font-medium">{t("coderQueue.colMrn")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("coderQueue.colStatus")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("coderQueue.colReason")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("coderQueue.colDetail")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("coderQueue.colAction")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <ItemRow key={item.item_id} item={item} onClaim={(id) => void claim(id)} onResolve={(id, note) => void resolve(id, note)} busy={busy} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-ink-faint">{t("coderQueue.prototypeNote")}</p>
    </div>
  );
}
