/**
 * RejectionCostDashboard unit tests — the E3 prospective panel reflects the
 * claim simulator's verdicts alongside the historical analytics, and a
 * simulator failure must never break the historical view. Administrative
 * only (CLAUDE.md §2): SAR values estimate billing-paperwork exposure, never
 * anything clinical.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import RejectionCostDashboard from "./RejectionCostDashboard";
import { api } from "../../lib/api";
import type { NphiesRejectionAnalytics, ClaimSimulationReport } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: {
    admin: {
      nphiesRejectionAnalytics: vi.fn(),
      runClaimSimulator: vi.fn(),
    },
  },
  ApiError: class ApiError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

// Same shape as the other panel tests: t() returns the key, so assertions
// target i18n keys rather than translated copy.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn() },
  }),
}));

const mockAnalytics = vi.mocked(api.admin.nphiesRejectionAnalytics);
const mockSimulator = vi.mocked(api.admin.runClaimSimulator);

const ANALYTICS: NphiesRejectionAnalytics = {
  range: { since: null, until: null },
  total_claims: 60,
  rejected_claims: 19,
  rejection_rate: 19 / 60,
  first_claim_at: null,
  last_claim_at: null,
  by_status: [
    { status: "accepted", count: 41 },
    { status: "rejected", count: 19 },
  ],
  by_rejection_code: [{ code: "DEV-NEC-07", count: 5 }],
  by_week: [],
  disclaimer: "Administrative counts only.",
  generated_at: "2026-01-01T00:00:00Z",
};

function simulation(overrides: Partial<ClaimSimulationReport["summary"]> = {}): ClaimSimulationReport {
  return {
    generated_at: "2026-01-01T00:00:00Z",
    graph_available: true,
    patients: [],
    summary: {
      patients_checked: 5,
      send: 0,
      fix_before_send: 4,
      do_not_send: 1,
      orders_checked: 3,
      orders_green: 2,
      orders_yellow: 0,
      orders_red: 1,
      orders_unavailable: 0,
      claims_flagged: 5,
      estimated_sar_at_risk: 12_500,
      average_claim_value_sar: 2_500,
      ...overrides,
    },
    disclaimer: "Simulation only.",
  };
}

describe("RejectionCostDashboard — prospective (E3) panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalytics.mockResolvedValue(ANALYTICS);
  });

  it("renders the simulator's flagged claims and prospective SAR alongside the historical figures", async () => {
    mockSimulator.mockResolvedValue(simulation());
    render(<RejectionCostDashboard />);
    await waitFor(() => {
      // Historical rejected count (summary card + status table both show it).
      expect(screen.getAllByText("19").length).toBeGreaterThan(0);
    });
    expect(await screen.findByText("rejectionCost.prospectiveTitle")).toBeInTheDocument();
    // Prospective cards reflect the simulation summary verbatim.
    expect(screen.getByText("rejectionCost.prospectiveFlagged")).toBeInTheDocument();
    expect(screen.getAllByText("5").length).toBeGreaterThan(0); // flagged claims
    expect(screen.getAllByText("SAR 12,500").length).toBeGreaterThan(0);
    expect(screen.getByText("rejectionCost.prospectiveLink")).toBeInTheDocument();
  });

  it("keeps the historical dashboard fully usable when the simulator is unavailable", async () => {
    mockSimulator.mockRejectedValue(new Error("engine down"));
    render(<RejectionCostDashboard />);
    expect(await screen.findByText("rejectionCost.prospectiveUnavailable")).toBeInTheDocument();
    // Historical cards still rendered.
    expect(screen.getByText("Rejected claims")).toBeInTheDocument();
    expect(screen.getAllByText("19").length).toBeGreaterThan(0);
  });
});
