/**
 * AuditPage — audit log search and integrity verification.
 *
 * Constraints:
 * - No severity indicators
 * - PHI-free display (events contain IDs and codes only)
 */

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, Archive, ShieldAlert } from "lucide-react";
import ComplianceReport from "../../../components/ComplianceReport/ComplianceReport";
import { api, type AuditEventItem, type AuditVerifyResult, ApiError } from "../../../lib/api";

interface AuditFilters {
  action: string;
  actor_id: string;
  target_id: string;
  since: string;
  until: string;
  outcome: string;
}

const AUDIT_ACTIONS = [
  "", "HTTP_REQUEST", "PATIENT_VIEW", "QA_REQUEST", "QA_ANSWERED", "QA_REFUSED",
  "NARRATIVE_GENERATE", "HANDOFF_GENERATE", "AUTH_LOGIN", "AUTH_LOGOUT",
  "AUDIT_LOG_ACCESSED", "USER_CREATED", "ROLE_CHANGED", "USER_DISABLED",
  "CONFIG_CHANGED", "DSR_RECEIVED", "IDENTITY_QUARANTINE_RESOLVED",
];

const OUTCOMES = ["", "SUCCESS", "FAILURE", "REFUSED"];

export default function AuditPage(): JSX.Element {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<AuditFilters>({
    action: "",
    actor_id: "",
    target_id: "",
    since: "",
    until: "",
    outcome: "",
  });

  const [events, setEvents] = useState<AuditEventItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [verifyResult, setVerifyResult] = useState<AuditVerifyResult | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [wormMessage, setWormMessage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [wormError, setWormError] = useState<string | null>(null);

  const handleSearch = useCallback((): void => {
    setIsLoading(true);
    setError(null);
    setEvents([]);
    setNextCursor(null);

    const params = {
      action: filters.action || undefined,
      actor_id: filters.actor_id || undefined,
      target_id: filters.target_id || undefined,
      since: filters.since || undefined,
      until: filters.until || undefined,
      outcome: filters.outcome || undefined,
      limit: 50,
    };

    api.admin
      .listAudit(params)
      .then((data) => {
        setEvents(data.data);
        setHasMore(data.pagination.has_more);
        setNextCursor(data.pagination.next_cursor);
      })
      .catch((err: unknown) => {
        const msg = err instanceof ApiError ? err.message : "Failed to load audit log";
        setError(msg);
      })
      .finally(() => setIsLoading(false));
  }, [filters]);

  const handleLoadMore = useCallback((): void => {
    if (!nextCursor || isLoading) return;
    setIsLoading(true);
    api.admin
      .listAudit({ cursor: nextCursor, limit: 50 })
      .then((data) => {
        setEvents((prev) => [...prev, ...data.data]);
        setHasMore(data.pagination.has_more);
        setNextCursor(data.pagination.next_cursor);
      })
      .catch(() => { /* silent */ })
      .finally(() => setIsLoading(false));
  }, [nextCursor, isLoading]);

  const handleVerify = useCallback((): void => {
    setIsVerifying(true);
    setVerifyResult(null);
    setVerifyError(null);

    api.admin
      .verifyAudit()
      .then((result) => setVerifyResult(result))
      .catch((err: unknown) => {
        const msg =
          err instanceof ApiError && err.status === 403
            ? "Not authorized — verification requires an administrator role."
            : err instanceof ApiError
              ? err.message
              : "Verification failed";
        setVerifyError(msg);
      })
      .finally(() => setIsVerifying(false));
  }, []);

  const handleExportWorm = useCallback((): void => {
    setIsExporting(true);
    setWormMessage(null);
    setWormError(null);

    api.admin
      .exportWorm()
      .then((result) => setWormMessage(result.message))
      .catch((err: unknown) => {
        const msg =
          err instanceof ApiError && err.status === 403
            ? "Not authorized — WORM export requires an administrator role."
            : err instanceof ApiError
              ? err.message
              : "WORM export failed";
        setWormError(msg);
      })
      .finally(() => setIsExporting(false));
  }, []);

  return (
    <div className="min-h-screen bg-wash text-ink p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <h1 className="text-lg font-semibold">Audit Log</h1>

        <ComplianceReport />

        {/* S4.3 — tamper detection + WORM export, verified live in the UI.
            Per docs/data/04-audit-log.md: every event carries
            hash_self = SHA-256(canonical row incl. hash_prev), forming a
            chain; verification replays it; a daily 02:00 job exports NDJSON
            (gzip + SHA-256) to in-Kingdom object storage with Object Lock. */}
        <div className="bg-white border border-line rounded-2xl shadow-card p-4 space-y-3" data-testid="tamper-detection-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-medium text-ink-deep">
                <ShieldCheck className="h-4 w-4 text-status-ok" aria-hidden="true" />
                {t("audit.tamperTitle")}
              </h2>
              <p className="mt-0.5 text-xs text-ink-soft">{t("audit.tamperSubtitle")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleVerify}
                disabled={isVerifying}
                className="border border-line text-ink text-sm px-4 py-2 rounded hover:bg-veil disabled:opacity-50"
              >
                {isVerifying ? "Verifying..." : "Verify Integrity"}
              </button>
              <button
                onClick={handleExportWorm}
                disabled={isExporting}
                className="inline-flex items-center gap-1.5 border border-line text-ink text-sm px-4 py-2 rounded hover:bg-veil disabled:opacity-50"
              >
                <Archive className="h-4 w-4" aria-hidden="true" />
                {isExporting ? t("audit.wormExporting") : t("audit.wormExport")}
              </button>
            </div>
          </div>

          {verifyResult && (
            <div
              data-testid="verify-result"
              className={`rounded-lg p-3 text-sm ${
                verifyResult.passed
                  ? "bg-emerald-500/10 border border-emerald-500/30"
                  : "bg-red-500/10 border border-red-500/40"
              }`}
            >
              <p className="font-medium flex items-center gap-2">
                {verifyResult.passed ? (
                  <ShieldCheck className="h-4 w-4 text-status-ok" aria-hidden="true" />
                ) : null}
                {verifyResult.passed ? t("audit.passed") : t("audit.failed")} —{" "}
                {verifyResult.passed
                  ? t("audit.eventsVerified", { count: verifyResult.events_verified })
                  : t("audit.failedEvents", { count: verifyResult.violations.length })}
              </p>
              <p className="text-ink-soft mt-1 text-xs">
                {t("audit.checkedWindow", {
                  start: verifyResult.started_at,
                  end: verifyResult.finished_at,
                })}
              </p>
              {!verifyResult.passed && verifyResult.violations.length > 0 && (
                <ul className="mt-2 space-y-1 text-ink-deep">
                  {verifyResult.violations.map((v) => (
                    <li key={v.event_id} dir="ltr" className="font-mono text-xs">
                      Event {v.event_id}: {v.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {verifyError && (
            <p role="alert" data-testid="verify-error" className="flex items-center gap-2 rounded-xl border border-status-rej-line bg-status-rej-bg px-3 py-2 text-sm text-status-rej">
              <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              {verifyError}
            </p>
          )}

          {wormMessage && (
            <p data-testid="worm-result" className="rounded-lg border border-line bg-veil p-3 text-xs text-ink-deep">
              <Archive className="me-1.5 inline h-3.5 w-3.5 text-ink-soft" aria-hidden="true" />
              {t("audit.wormDone")}: {wormMessage}
            </p>
          )}
          {wormError && (
            <p role="alert" data-testid="worm-error" className="flex items-center gap-2 rounded-xl border border-status-rej-line bg-status-rej-bg px-3 py-2 text-sm text-status-rej">
              <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              {wormError}
            </p>
          )}

          <p className="text-xs text-ink-faint">{t("audit.wormScheduleNote")}</p>
        </div>
        {/* Filters */}
        <div className="bg-white border border-line rounded-2xl shadow-card p-4 space-y-4">
          <h2 className="text-sm font-medium text-ink-deep">Filters</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label htmlFor="audit-filter-action" className="block text-xs text-ink-soft mb-1">Action</label>
              <select
                id="audit-filter-action"
                value={filters.action}
                onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
                className="w-full bg-veil border border-line rounded px-3 py-2 text-sm text-ink"
              >
                {AUDIT_ACTIONS.map((a) => (
                  <option key={a} value={a}>{a || "All actions"}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="audit-filter-outcome" className="block text-xs text-ink-soft mb-1">Outcome</label>
              <select
                id="audit-filter-outcome"
                value={filters.outcome}
                onChange={(e) => setFilters((f) => ({ ...f, outcome: e.target.value }))}
                className="w-full bg-veil border border-line rounded px-3 py-2 text-sm text-ink"
              >
                {OUTCOMES.map((o) => (
                  <option key={o} value={o}>{o || "All outcomes"}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="audit-filter-actor-id" className="block text-xs text-ink-soft mb-1">Actor ID</label>
              <input
                id="audit-filter-actor-id"
                type="text"
                value={filters.actor_id}
                onChange={(e) => setFilters((f) => ({ ...f, actor_id: e.target.value }))}
                placeholder="User UUID"
                className="w-full bg-veil border border-line rounded px-3 py-2 text-sm text-ink placeholder-ink-faint"
              />
            </div>

            <div>
              <label htmlFor="audit-filter-target-id" className="block text-xs text-ink-soft mb-1">Target ID</label>
              <input
                id="audit-filter-target-id"
                type="text"
                value={filters.target_id}
                onChange={(e) => setFilters((f) => ({ ...f, target_id: e.target.value }))}
                placeholder="Resource UUID"
                className="w-full bg-veil border border-line rounded px-3 py-2 text-sm text-ink placeholder-ink-faint"
              />
            </div>

            <div>
              <label htmlFor="audit-filter-since" className="block text-xs text-ink-soft mb-1">Since</label>
              <input
                id="audit-filter-since"
                type="datetime-local"
                value={filters.since}
                onChange={(e) => setFilters((f) => ({ ...f, since: e.target.value }))}
                className="w-full bg-veil border border-line rounded px-3 py-2 text-sm text-ink"
              />
            </div>

            <div>
              <label htmlFor="audit-filter-until" className="block text-xs text-ink-soft mb-1">Until</label>
              <input
                id="audit-filter-until"
                type="datetime-local"
                value={filters.until}
                onChange={(e) => setFilters((f) => ({ ...f, until: e.target.value }))}
                className="w-full bg-veil border border-line rounded px-3 py-2 text-sm text-ink"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSearch}
              disabled={isLoading}
              className="bg-white text-ink text-sm px-4 py-2 rounded hover:bg-line disabled:opacity-50"
            >
              {isLoading ? "Loading..." : "Search"}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="text-ink-soft text-sm">{error}</p>
        )}

        {/* Results table */}
        {events.length > 0 && (
          <div className="bg-white rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-line text-ink-soft text-xs">
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Actor</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Target</th>
                    <th className="px-4 py-3">Outcome</th>
                    <th className="px-4 py-3">Metadata</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id} className="border-b border-line hover:bg-veil">
                      <td className="px-4 py-3 text-ink-deep whitespace-nowrap">
                        {new Date(event.ts).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-ink-deep">
                        {event.actor.display_name ?? event.actor.id ?? "System"}
                        {event.actor.role && (
                          <span className="text-ink-soft text-xs ml-1">({event.actor.role})</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink-deep font-mono text-xs">
                        {event.action}
                      </td>
                      <td className="px-4 py-3 text-ink-soft text-xs">
                        {event.target_type && <span>{event.target_type}</span>}
                        {event.target_id && <span className="ml-1 font-mono">{event.target_id.slice(0, 8)}…</span>}
                      </td>
                      <td className="px-4 py-3 text-ink-deep text-xs">{event.outcome}</td>
                      <td className="px-4 py-3 text-ink-soft text-xs font-mono max-w-xs truncate">
                        {JSON.stringify(event.metadata_json)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hasMore && (
              <div className="p-4 text-center">
                <button
                  onClick={handleLoadMore}
                  disabled={isLoading}
                  className="text-sm text-ink-soft hover:text-ink disabled:opacity-50"
                >
                  Load more
                </button>
              </div>
            )}
          </div>
        )}

        {!isLoading && events.length === 0 && !error && (
          <p className="text-ink-soft text-sm">Run a search to view audit events.</p>
        )}
      </div>
    </div>
  );
}
