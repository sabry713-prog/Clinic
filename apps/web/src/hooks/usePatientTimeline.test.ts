/**
 * usePatientTimeline tests (Phase 2, audit M-4).
 *
 * The assertions that matter: real data replaces the hardcoded constant, the
 * feed is ordered by date only (never by clinical importance), and one failing
 * source degrades that section rather than blanking the timeline.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePatientTimeline } from "./usePatientTimeline";
import { api } from "../lib/api";

vi.mock("../lib/api", () => ({
  api: {
    patients: {
      encounters: vi.fn(),
      observations: vi.fn(),
      medications: vi.fn(),
    },
  },
}));

const mockEncounters = vi.mocked(api.patients.encounters);
const mockObservations = vi.mocked(api.patients.observations);
const mockMedications = vi.mocked(api.patients.medications);

function page<T>(data: T[]) {
  return { data, next_cursor: null, total: data.length };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEncounters.mockResolvedValue(
    page([
      {
        id: "e1",
        encounter_type: "Cardiology clinic visit",
        status: "finished",
        started_at: "2026-07-18T09:00:00Z",
        ended_at: null,
        ward: "Ward-4A",
      },
    ]) as never,
  );
  mockObservations.mockResolvedValue(
    page([
      {
        id: "o1",
        category: "laboratory",
        code: "4548-4",
        code_display: "HbA1c",
        value_numeric: 7.8,
        value_text: null,
        unit: "%",
        ref_range_low: 4,
        ref_range_high: 5.6,
        ref_range_text: null,
        effective_at: "2026-07-20T09:00:00Z",
      },
    ]) as never,
  );
  mockMedications.mockResolvedValue(
    page([
      {
        id: "m1",
        medication_display: "Metformin 1000 mg",
        code: null,
        dose: "1000 mg",
        route: "Oral",
        frequency: "twice daily",
        status: "active",
        started_at: "2026-07-02T09:00:00Z",
        ended_at: null,
      },
    ]) as never,
  );
});

describe("usePatientTimeline", () => {
  it("fetches nothing without a patient", () => {
    const { result } = renderHook(() => usePatientTimeline(null));
    expect(result.current.entries).toEqual([]);
    expect(mockEncounters).not.toHaveBeenCalled();
  });

  it("merges all three sources into one feed", async () => {
    const { result } = renderHook(() => usePatientTimeline("pat-1"));
    await waitFor(() => expect(result.current.entries.length).toBe(3));
    const kinds = result.current.entries.map((e) => e.kind);
    expect(kinds).toContain("encounter");
    expect(kinds).toContain("lab");
    expect(kinds).toContain("medication");
  });

  it("orders strictly by date, newest first", async () => {
    const { result } = renderHook(() => usePatientTimeline("pat-1"));
    await waitFor(() => expect(result.current.entries.length).toBe(3));
    const dates = result.current.entries.map((e) => e.at);
    expect(dates).toEqual(["2026-07-20", "2026-07-18", "2026-07-02"]);
  });

  it("renders lab values with the source's own reference range", async () => {
    const { result } = renderHook(() => usePatientTimeline("pat-1"));
    await waitFor(() => expect(result.current.entries.length).toBe(3));
    const lab = result.current.entries.find((e) => e.kind === "lab");
    // Value + unit + range verbatim; no high/low flag, no interpretation.
    expect(lab?.detail).toBe("7.8 % (ref 4–5.6)");
    expect(lab?.detail).not.toMatch(/high|low|abnormal/i);
  });

  it("classifies imaging observations separately from labs", async () => {
    mockObservations.mockResolvedValue(
      page([
        {
          id: "o2",
          category: "imaging",
          code: null,
          code_display: "Chest X-ray",
          value_numeric: null,
          value_text: "No acute abnormality",
          unit: null,
          ref_range_low: null,
          ref_range_high: null,
          ref_range_text: null,
          effective_at: "2026-05-14T09:00:00Z",
        },
      ]) as never,
    );
    const { result } = renderHook(() => usePatientTimeline("pat-1"));
    await waitFor(() => expect(result.current.entries.length).toBe(3));
    expect(result.current.entries.some((e) => e.kind === "imaging")).toBe(true);
  });

  it("degrades one failing source instead of blanking the timeline", async () => {
    mockObservations.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => usePatientTimeline("pat-1"));
    await waitFor(() => expect(result.current.partialError).not.toBeNull());
    // The other two sources still rendered.
    expect(result.current.entries.length).toBe(2);
    expect(result.current.partialError).toMatch(/observations/);
  });

  it("reports no error when everything loads", async () => {
    const { result } = renderHook(() => usePatientTimeline("pat-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.partialError).toBeNull();
  });

  it("keeps undated records rather than dropping them", async () => {
    mockMedications.mockResolvedValue(
      page([
        {
          id: "m2",
          medication_display: "Aspirin",
          code: null,
          dose: null,
          route: null,
          frequency: null,
          status: "active",
          started_at: null,
          ended_at: null,
        },
      ]) as never,
    );
    const { result } = renderHook(() => usePatientTimeline("pat-1"));
    await waitFor(() => expect(result.current.entries.length).toBe(3));
    const undated = result.current.entries.find((e) => e.title === "Aspirin");
    expect(undated).toBeDefined();
    // Undated sinks to the bottom.
    expect(result.current.entries.at(-1)?.title).toBe("Aspirin");
  });
});
