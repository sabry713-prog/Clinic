/**
 * AdminQuarantinePage — identity quarantine queue management.
 * Allows hospital admins to review flagged identity matches and decide
 * to merge or keep-separate.
 */

import { useState, useEffect } from "react";
import { api, type QuarantineItem, ApiError } from "../../../lib/api";

interface ResolveState {
  readonly id: string;
  readonly action: "merge" | "keep_separate";
}

export default function QuarantinePage(): JSX.Element {
  const [items, setItems] = useState<QuarantineItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<ResolveState | null>(null);
  const [reasonInput, setReasonInput] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    api.quarantine
      .list()
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch((err: unknown) => {
        const msg = err instanceof ApiError ? err.message : "Failed to load quarantine queue";
        setError(msg);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const handleResolve = (id: string, action: "merge" | "keep_separate"): void => {
    setResolving({ id, action });
    setReasonInput("");
    setSuccessMessage(null);
  };

  const confirmResolve = (): void => {
    if (!resolving) return;

    api.quarantine
      .resolve(resolving.id, resolving.action, reasonInput)
      .then(() => {
        setItems((prev) => prev.filter((i) => i.id !== resolving.id));
        setSuccessMessage(
          `Record ${resolving.action === "merge" ? "merged" : "kept separate"} successfully`,
        );
        setResolving(null);
      })
      .catch((err: unknown) => {
        const msg = err instanceof ApiError ? err.message : "Resolve action failed";
        setError(msg);
        setResolving(null);
      });
  };

  const openItems = items.filter((i) => i.status === "open");

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold mb-2">Identity Quarantine Queue</h1>
        <p className="text-sm text-slate-400 mb-6">
          Records flagged for potential duplicate identity. Review and resolve each case.
        </p>

        {successMessage && (
          <div className="mb-4 p-3 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-300">
            {successMessage}
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-400">
            {error}
          </div>
        )}

        {/* Resolve confirmation modal */}
        {resolving && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-md w-full mx-4">
              <h2 className="text-base font-semibold mb-3">
                Confirm: {resolving.action === "merge" ? "Merge records" : "Keep separate"}
              </h2>
              <p className="text-sm text-slate-400 mb-4">
                Provide a reason for this decision (required for audit log).
              </p>
              <textarea
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                rows={3}
                placeholder="Clinical rationale..."
                className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500 resize-none mb-4"
              />
              <div className="flex gap-3">
                <button
                  onClick={confirmResolve}
                  disabled={!reasonInput.trim()}
                  className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-white hover:bg-slate-600 disabled:opacity-50 transition-colors"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setResolving(null)}
                  className="flex-1 px-4 py-2 bg-transparent border border-slate-700 rounded-md text-sm text-slate-400 hover:border-slate-500 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-slate-400">Loading queue...</p>
        ) : openItems.length === 0 ? (
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-8 text-center">
            <p className="text-slate-500 text-sm">No open quarantine records</p>
          </div>
        ) : (
          <div className="space-y-4">
            {openItems.map((item) => (
              <div
                key={item.id}
                className="bg-slate-900 border border-slate-700 rounded-lg p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 flex-1">
                    <p className="text-xs text-slate-500 font-mono">ID: {item.id}</p>
                    <div className="grid grid-cols-2 gap-4 mt-2">
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Candidate A</p>
                        <p className="text-sm font-mono text-white">{item.candidate_a_id}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Candidate B</p>
                        <p className="text-sm font-mono text-white">{item.candidate_b_id}</p>
                      </div>
                    </div>
                    <p className="text-xs text-slate-400 mt-2">
                      Confidence score: {Math.round(item.confidence * 100)}% —
                      Created: {new Date(item.created_at).toLocaleDateString()}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleResolve(item.id, "merge")}
                      className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-md text-xs text-white hover:bg-slate-600 transition-colors"
                    >
                      Merge
                    </button>
                    <button
                      onClick={() => handleResolve(item.id, "keep_separate")}
                      className="px-3 py-1.5 bg-transparent border border-slate-700 rounded-md text-xs text-slate-300 hover:border-slate-500 transition-colors"
                    >
                      Keep separate
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
