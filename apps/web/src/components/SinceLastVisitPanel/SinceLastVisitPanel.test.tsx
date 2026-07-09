/**
 * SinceLastVisitPanel unit tests.
 *
 * - Renders items with their type label and date
 * - Renders the first-visit empty state
 * - Renders the nothing-new empty state
 * - Every rendered item uses the same CSS classes regardless of type
 *   (proving no severity color-coding crept in)
 * - Fetches automatically on mount (this is a supplementary always-visible
 *   panel, not a chip-gated card, so no explicit user action is required)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import SinceLastVisitPanel from "./SinceLastVisitPanel";
import { api } from "../../lib/api";
import type { SinceLastVisit } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: {
    patients: {
      sinceLastVisit: vi.fn(),
    },
  },
}));

const mockSinceLastVisit = vi.mocked(api.patients.sinceLastVisit);

const WITH_ITEMS: SinceLastVisit = {
  has_previous_encounter: true,
  boundary_at: "2026-06-01",
  items: [
    { type: "condition", code_display: "Atrial fibrillation", onset_date: "2026-06-15" },
    { type: "allergy", code_display: "Penicillin", reaction: "Rash", recorded_at: "2026-06-20" },
    { type: "medication", medication_display: "Warfarin", dose: "5mg", route: "oral", frequency: "once daily", started_at: "2026-06-25" },
  ],
};

const FIRST_VISIT: SinceLastVisit = { has_previous_encounter: false, boundary_at: null, items: [] };
const NOTHING_NEW: SinceLastVisit = { has_previous_encounter: true, boundary_at: "2026-06-01", items: [] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SinceLastVisitPanel", () => {
  it("fetches automatically on mount without any user action", () => {
    mockSinceLastVisit.mockResolvedValueOnce(FIRST_VISIT);
    render(<SinceLastVisitPanel patientId="patient-001" />);
    expect(mockSinceLastVisit).toHaveBeenCalledWith("patient-001");
  });

  it("renders items with their type label and date", async () => {
    mockSinceLastVisit.mockResolvedValueOnce(WITH_ITEMS);
    render(<SinceLastVisitPanel patientId="patient-001" />);
    await waitFor(() => expect(screen.getAllByTestId("since-last-visit-item")).toHaveLength(3));
    const text = screen.getByTestId("since-last-visit-panel").textContent ?? "";
    expect(text).toContain("Atrial fibrillation");
    expect(text).toContain("Penicillin");
    expect(text).toContain("Warfarin");
  });

  it("renders the first-visit empty state", async () => {
    mockSinceLastVisit.mockResolvedValueOnce(FIRST_VISIT);
    render(<SinceLastVisitPanel patientId="patient-001" />);
    await waitFor(() =>
      expect(screen.getByTestId("since-last-visit-empty").textContent).toContain("first documented encounter"),
    );
  });

  it("renders the nothing-new empty state", async () => {
    mockSinceLastVisit.mockResolvedValueOnce(NOTHING_NEW);
    render(<SinceLastVisitPanel patientId="patient-001" />);
    await waitFor(() =>
      expect(screen.getByTestId("since-last-visit-empty").textContent).toContain("Nothing new"),
    );
  });

  it("every rendered item uses the same CSS classes regardless of type", async () => {
    mockSinceLastVisit.mockResolvedValueOnce(WITH_ITEMS);
    render(<SinceLastVisitPanel patientId="patient-001" />);
    await waitFor(() => expect(screen.getAllByTestId("since-last-visit-item")).toHaveLength(3));
    const items = screen.getAllByTestId("since-last-visit-item");
    const classNames = items.map((el) => el.className);
    expect(new Set(classNames).size).toBe(1);
  });

  it("renders nothing (no crash) when the fetch fails", async () => {
    mockSinceLastVisit.mockRejectedValueOnce(new Error("network error"));
    render(<SinceLastVisitPanel patientId="patient-001" />);
    await waitFor(() => expect(mockSinceLastVisit).toHaveBeenCalled());
    expect(screen.queryByTestId("since-last-visit-panel")).not.toBeInTheDocument();
  });
});
