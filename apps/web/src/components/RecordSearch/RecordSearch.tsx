/**
 * RecordSearch — full-text search over the patient record (E2).
 *
 * Returns VERBATIM record excerpts grouped by source type, newest first.
 * No synthesis, no interpretation — the safest feature shape. Works for
 * English, Arabic, and code-switched queries.
 */

import { useState, useCallback } from "react";
import { api, type RecordSearchResponse, ApiError } from "../../lib/api";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

interface RecordSearchProps {
  readonly patientId: string;
}

export default function RecordSearch({ patientId }: RecordSearchProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RecordSearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(() => {
    const q = query.trim();
    if (!q) return;
    setIsSearching(true);
    setError(null);
    api.patients
      .searchRecord(patientId, q)
      .then((data) => setResults(data))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Search failed");
        setResults(null);
      })
      .finally(() => setIsSearching(false));
  }, [patientId, query]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6">
      <h2 className="text-base font-semibold text-white mb-1">Search record</h2>
      <p className="text-xs text-slate-500 mb-4">
        Finds verbatim entries in this patient&apos;s record. English, Arabic, or mixed.
      </p>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={query}
          dir="auto"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
          placeholder="Search e.g. creatinine, warfarin, دوخة…"
          className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
        />
        <button
          onClick={runSearch}
          disabled={isSearching || !query.trim()}
          className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-500 transition-colors"
        >
          {isSearching ? "Searching…" : "Search"}
        </button>
      </div>

      {error && <p className="text-sm text-slate-400">{error}</p>}

      {results && !error && (
        results.total === 0 ? (
          <p className="text-sm text-slate-500">No matching entries in this patient&apos;s record.</p>
        ) : (
          <div className="space-y-5">
            <p className="text-xs text-slate-500">{results.total} entr{results.total === 1 ? "y" : "ies"} found</p>
            {results.groups.map((group) => (
              <div key={group.source_type}>
                <h3 className="text-sm font-medium text-slate-300 capitalize mb-2">
                  {group.source_type} ({group.results.length})
                </h3>
                <ul className="space-y-2">
                  {group.results.map((r) => (
                    <li
                      key={r.source_id}
                      className="text-sm text-white bg-slate-800/50 border border-slate-800 rounded-md px-3 py-2"
                      title={`${r.source_type} · ${r.source_id}`}
                    >
                      <span dir="auto">{r.excerpt}</span>
                      {formatDate(r.recorded_at) && (
                        <span className="block text-xs text-slate-500 mt-1" dir="ltr">
                          {formatDate(r.recorded_at)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
