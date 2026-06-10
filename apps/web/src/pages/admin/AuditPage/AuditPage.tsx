/**
 * AuditPage — audit log search and integrity verification.
 *
 * Constraints:
 * - No severity indicators
 * - PHI-free display (events contain IDs and codes only)
 */

import { useState, useCallback } from "react";
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
        const msg = err instanceof ApiError ? err.message : "Verification failed";
        setVerifyError(msg);
      })
      .finally(() => setIsVerifying(false));
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <h1 className="text-lg font-semibold">Audit Log</h1>

        {/* Filters */}
        <div className="bg-slate-900 rounded-xl p-4 space-y-4">
          <h2 className="text-sm font-medium text-slate-300">Filters</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Action</label>
              <select
                value={filters.action}
                onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white"
              >
                {AUDIT_ACTIONS.map((a) => (
                  <option key={a} value={a}>{a || "All actions"}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Outcome</label>
              <select
                value={filters.outcome}
                onChange={(e) => setFilters((f) => ({ ...f, outcome: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white"
              >
                {OUTCOMES.map((o) => (
                  <option key={o} value={o}>{o || "All outcomes"}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Actor ID</label>
              <input
                type="text"
                value={filters.actor_id}
                onChange={(e) => setFilters((f) => ({ ...f, actor_id: e.target.value }))}
                placeholder="User UUID"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white placeholder-slate-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Target ID</label>
              <input
                type="text"
                value={filters.target_id}
                onChange={(e) => setFilters((f) => ({ ...f, target_id: e.target.value }))}
                placeholder="Resource UUID"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white placeholder-slate-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Since</label>
              <input
                type="datetime-local"
                value={filters.since}
                onChange={(e) => setFilters((f) => ({ ...f, since: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Until</label>
              <input
                type="datetime-local"
                value={filters.until}
                onChange={(e) => setFilters((f) => ({ ...f, until: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSearch}
              disabled={isLoading}
              className="bg-white text-slate-950 text-sm px-4 py-2 rounded hover:bg-slate-200 disabled:opacity-50"
            >
              {isLoading ? "Loading..." : "Search"}
            </button>

            <button
              onClick={handleVerify}
              disabled={isVerifying}
              className="border border-slate-700 text-white text-sm px-4 py-2 rounded hover:bg-slate-800 disabled:opacity-50"
            >
              {isVerifying ? "Verifying..." : "Verify Integrity"}
            </button>
          </div>
        </div>

        {/* Verify result */}
        {verifyResult && (
          <div
            className={`rounded-xl p-4 text-sm ${
              verifyResult.passed ? "bg-slate-800 border border-slate-700" : "bg-slate-900 border border-slate-600"
            }`}
          >
            <p className="font-medium">
              Integrity check: {verifyResult.passed ? "Passed" : "Failed"}
            </p>
            <p className="text-slate-400 mt-1">
              Events verified: {verifyResult.events_verified} · Checked {verifyResult.started_at} – {verifyResult.finished_at}
            </p>
            {!verifyResult.passed && verifyResult.violations.length > 0 && (
              <ul className="mt-2 space-y-1 text-slate-300">
                {verifyResult.violations.map((v) => (
                  <li key={v.event_id}>
                    Event {v.event_id}: {v.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {verifyError && (
          <p className="text-slate-400 text-sm">{verifyError}</p>
        )}

        {/* Error */}
        {error && (
          <p className="text-slate-400 text-sm">{error}</p>
        )}

        {/* Results table */}
        {events.length > 0 && (
          <div className="bg-slate-900 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-xs">
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
                    <tr key={event.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                      <td className="px-4 py-3 text-slate-300 whitespace-nowrap">
                        {new Date(event.ts).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {event.actor.display_name ?? event.actor.id ?? "System"}
                        {event.actor.role && (
                          <span className="text-slate-500 text-xs ml-1">({event.actor.role})</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-200 font-mono text-xs">
                        {event.action}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {event.target_type && <span>{event.target_type}</span>}
                        {event.target_id && <span className="ml-1 font-mono">{event.target_id.slice(0, 8)}…</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs">{event.outcome}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs font-mono max-w-xs truncate">
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
                  className="text-sm text-slate-400 hover:text-white disabled:opacity-50"
                >
                  Load more
                </button>
              </div>
            )}
          </div>
        )}

        {!isLoading && events.length === 0 && !error && (
          <p className="text-slate-500 text-sm">Run a search to view audit events.</p>
        )}
      </div>
    </div>
  );
}
