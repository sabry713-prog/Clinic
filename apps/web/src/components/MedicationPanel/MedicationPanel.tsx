/**
 * MedicationPanel — displays the patient's medication list.
 *
 * Constraints:
 * - No interaction checking, no flags, no clinical alerts
 * - Plain text display of medication name, dose, route, frequency, status
 * - No interpretation of medication appropriateness
 */

import { useShowMore, ShowMoreButton } from "../ShowMore/ShowMore";

const INITIAL_ROWS = 5;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export interface MedicationItem {
  readonly id: string;
  readonly medication_display: string | null;
  readonly code: string | null;
  readonly dose: string | null;
  readonly route: string | null;
  readonly frequency: string | null;
  readonly status: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
}

interface MedicationPanelProps {
  readonly medications: readonly MedicationItem[];
  readonly isLoading: boolean;
}

export default function MedicationPanel({
  medications,
  isLoading,
}: MedicationPanelProps): JSX.Element {
  const rows = useShowMore(medications, INITIAL_ROWS);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6">
      <h2 className="text-base font-semibold text-white mb-4">Medications</h2>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading medications...</p>
      ) : medications.length === 0 ? (
        <p className="text-sm text-slate-500">No medications documented</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-700">
                <th className="pb-2 pr-4 font-medium">Medication</th>
                <th className="pb-2 pr-4 font-medium">Dose</th>
                <th className="pb-2 pr-4 font-medium">Route</th>
                <th className="pb-2 pr-4 font-medium">Frequency</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 pr-4 font-medium">Started</th>
              </tr>
            </thead>
            <tbody>
              {rows.visible.map((med) => (
                <tr key={med.id} className="border-b border-slate-800 last:border-0">
                  <td className="py-2 pr-4 text-white">
                    {med.medication_display ?? med.code ?? "Unknown"}
                  </td>
                  <td className="py-2 pr-4 text-white">{med.dose ?? "—"}</td>
                  <td className="py-2 pr-4 text-white">{med.route ?? "—"}</td>
                  <td className="py-2 pr-4 text-white">{med.frequency ?? "—"}</td>
                  {/* Status shown as plain text — no color coding */}
                  <td className="py-2 pr-4 text-slate-300">{med.status ?? "—"}</td>
                  <td className="py-2 pr-4 text-slate-400 whitespace-nowrap">
                    {formatDate(med.started_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ShowMoreButton state={rows} itemLabel="medications" />
        </div>
      )}
    </div>
  );
}
