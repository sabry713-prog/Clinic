/**
 * ProviderAvailabilityPage — admin CRUD for the recurring weekly slot
 * windows that back AI Receptionist self-service booking
 * (docs/architecture/ai-receptionist.md). v1 trim: weekly-recurring only,
 * no holiday/exception handling.
 */

import { useState, useEffect, useCallback } from "react";
import { api, type ProviderAvailability, ApiError } from "../../../lib/api";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function ProviderAvailabilityPage(): JSX.Element {
  const [rows, setRows] = useState<ProviderAvailability[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const [departmentDisplay, setDepartmentDisplay] = useState("");
  const [clinicianDisplay, setClinicianDisplay] = useState("");
  const [clinicianGender, setClinicianGender] = useState<"" | "male" | "female">("");
  const [dayOfWeek, setDayOfWeek] = useState(0);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [slotDurationMinutes, setSlotDurationMinutes] = useState(30);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(() => {
    setIsLoading(true);
    api.providerAvailability
      .list()
      .then((r) => setRows(r.data))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Failed to load"))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      await api.providerAvailability.create(
        departmentDisplay.trim(),
        clinicianDisplay.trim() || null,
        dayOfWeek,
        startTime,
        endTime,
        slotDurationMinutes,
        clinicianGender === "" ? null : clinicianGender,
      );
      setDepartmentDisplay("");
      setClinicianDisplay("");
      setClinicianGender("");
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create");
    } finally {
      setCreating(false);
    }
  }, [departmentDisplay, clinicianDisplay, clinicianGender, dayOfWeek, startTime, endTime, slotDurationMinutes, refresh]);

  const toggleActive = useCallback(
    async (id: string, active: boolean) => {
      setBusyIds((prev) => new Set(prev).add(id));
      setError(null);
      try {
        await api.providerAvailability.setActive(id, active);
        refresh();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Failed to update");
      } finally {
        setBusyIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      }
    },
    [refresh],
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Provider Availability</h1>
          <p className="text-xs text-slate-500 mt-1">
            Recurring weekly slot windows for AI Receptionist self-service booking. Administrative
            scheduling configuration only.
          </p>
        </div>

        {error && <p className="text-slate-400 text-sm">{error}</p>}

        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
          <label className="text-xs text-slate-400 col-span-2">
            Department
            <input
              type="text"
              value={departmentDisplay}
              onChange={(e) => setDepartmentDisplay(e.target.value)}
              className="mt-1 w-full bg-slate-950/60 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-sm"
            />
          </label>
          <label className="text-xs text-slate-400 col-span-2">
            Clinician (optional)
            <input
              type="text"
              value={clinicianDisplay}
              onChange={(e) => setClinicianDisplay(e.target.value)}
              className="mt-1 w-full bg-slate-950/60 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-sm"
            />
          </label>
          <label className="text-xs text-slate-400">
            Clinician gender
            <select
              value={clinicianGender}
              onChange={(e) => setClinicianGender(e.target.value as "" | "male" | "female")}
              className="mt-1 w-full bg-slate-950/60 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-sm"
              title="Lets patients express a scheduling preference. Leave unset to not declare."
            >
              <option value="">Not declared</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Day
            <select
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(Number(e.target.value))}
              className="mt-1 w-full bg-slate-950/60 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-sm"
            >
              {DAY_LABELS.map((label, i) => (
                <option key={label} value={i}>{label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Duration (min)
            <input
              type="number"
              min={1}
              value={slotDurationMinutes}
              onChange={(e) => setSlotDurationMinutes(Number(e.target.value))}
              className="mt-1 w-full bg-slate-950/60 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-sm"
            />
          </label>
          <label className="text-xs text-slate-400">
            Start
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="mt-1 w-full bg-slate-950/60 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-sm"
            />
          </label>
          <label className="text-xs text-slate-400">
            End
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="mt-1 w-full bg-slate-950/60 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => void create()}
            disabled={creating || !departmentDisplay.trim()}
            className="col-span-2 md:col-span-6 mt-2 text-xs px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
          >
            {creating ? "Adding…" : "Add availability window"}
          </button>
        </div>

        <div className="bg-slate-900 rounded-xl overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 text-xs">
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Clinician</th>
                <th className="px-4 py-3">Gender</th>
                <th className="px-4 py-3">Day</th>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const busy = busyIds.has(row.id);
                return (
                  <tr key={row.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                    <td className="px-4 py-3 text-white">{row.department_display}</td>
                    <td className="px-4 py-3 text-slate-300">{row.clinician_display ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-300">
                      {row.clinician_gender === "female" ? "Female" : row.clinician_gender === "male" ? "Male" : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{DAY_LABELS[row.day_of_week]}</td>
                    <td className="px-4 py-3 text-slate-300" dir="ltr">{row.start_time}–{row.end_time}</td>
                    <td className="px-4 py-3 text-slate-300">{row.slot_duration_minutes} min</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{row.active ? "Active" : "Inactive"}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => void toggleActive(row.id, !row.active)}
                        disabled={busy}
                        className="text-xs text-slate-400 hover:text-white border border-slate-700 rounded px-2 py-1 disabled:opacity-50"
                      >
                        {row.active ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!isLoading && rows.length === 0 && <p className="text-slate-500 text-sm p-4">No availability windows configured.</p>}
        </div>
      </div>
    </div>
  );
}
