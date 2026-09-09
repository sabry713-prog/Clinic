/**
 * PatientListPage — scoped patient list with search by name/MRN and ward filter.
 * Displays only patients in the authenticated user's care scope.
 *
 * No clinical interpretation, no severity indicators.
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, type PatientSummary, ApiError } from "../../lib/api";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function PatientListPage(): JSX.Element {
  const navigate = useNavigate();

  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [wardFilter, setWardFilter] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchPatients = useCallback(async (cursor?: string, append = false) => {
    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
      setError(null);
    }

    try {
      const result = await api.patients.list({
        cursor,
        limit: 20,
        q: debouncedSearch || undefined,
        ward: wardFilter || undefined,
      });

      if (append) {
        setPatients((prev) => [...prev, ...result.data]);
      } else {
        setPatients(result.data);
      }
      setNextCursor(result.next_cursor);
    } catch (err) {
      const msg = err instanceof ApiError
        ? `${err.code}: ${err.message}`
        : "Failed to load patients";
      setError(msg);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [debouncedSearch, wardFilter]);

  useEffect(() => {
    void fetchPatients();
  }, [fetchPatients]);

  const handleLoadMore = (): void => {
    if (nextCursor) {
      void fetchPatients(nextCursor, true);
    }
  };

  const handleRowClick = (patientId: string): void => {
    void navigate(`/patients/${patientId}`);
  };

  return (
    <div className="min-h-screen bg-wash text-ink p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold tracking-tight text-ink mb-6">Patients</h1>

        {/* Search and filter controls */}
        <div className="flex flex-wrap gap-4 mb-6">
          <input
            type="text"
            placeholder="Search by name or MRN"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-veil border border-line rounded-md px-3 py-2 text-sm text-ink placeholder-ink-faint focus:outline-none focus:border-line-strong w-64"
          />
          <input
            type="text"
            placeholder="Ward filter"
            value={wardFilter}
            onChange={(e) => setWardFilter(e.target.value)}
            className="bg-veil border border-line rounded-md px-3 py-2 text-sm text-ink placeholder-ink-faint focus:outline-none focus:border-line-strong w-48"
          />
        </div>

        {/* Patient table */}
        {isLoading ? (
          <p className="text-ink-soft text-sm">Loading patients...</p>
        ) : error ? (
          <div className="bg-white border border-line rounded-lg p-4">
            <p className="text-sm text-ink-deep">{error}</p>
          </div>
        ) : patients.length === 0 ? (
          <div className="bg-white border border-line rounded-lg p-8 text-center">
            <p className="text-ink-soft text-sm">No patients in your care scope</p>
          </div>
        ) : (
          <>
            <div className="bg-white border border-line rounded-2xl shadow-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-start text-[10.5px] uppercase tracking-[0.1em] text-ink-faint border-b border-line bg-veil/60">
                    <th className="px-4 py-3 font-medium">MRN</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Date of Birth</th>
                    <th className="px-4 py-3 font-medium">Sex</th>
                    <th className="px-4 py-3 font-medium">Ward</th>
                  </tr>
                </thead>
                <tbody>
                  {patients.map((patient) => (
                    <tr
                      key={patient.id}
                      onClick={() => handleRowClick(patient.id)}
                      className="border-b border-line last:border-0 hover:bg-veil cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-ink-deep">
                        {patient.mrn ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-ink font-medium">
                        {patient.display_name ?? "Unknown"}
                      </td>
                      <td className="px-4 py-3 text-ink-deep">
                        {formatDate(patient.date_of_birth)}
                      </td>
                      <td className="px-4 py-3 text-ink-deep capitalize">
                        {patient.sex ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-ink-deep">
                        {patient.ward ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {nextCursor && (
              <div className="mt-4 text-center">
                <button
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="px-5 py-2 bg-white border border-line rounded-full text-sm font-medium text-ink-deep hover:bg-veil disabled:opacity-50 transition-colors shadow-card"
                >
                  {isLoadingMore ? "Loading..." : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
