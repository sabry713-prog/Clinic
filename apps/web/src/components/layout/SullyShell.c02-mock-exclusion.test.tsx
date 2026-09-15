/**
 * C02 (readiness assessment): synthetic and live datasets are mutually
 * exclusive in the Sully shell. With a patient routed in, mock orders,
 * mock timeline entries, and initial canned messages must NOT render —
 * not while loading, not when the live record is empty, not on failure.
 * Offline demo mode (no patientId) keeps the mocks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SullyProvider } from "./SullyContext";
import TimelinePane from "./panes/TimelinePane";
import AiTeamDrawer from "./panes/AiTeamDrawer";
import { api } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: {
    patients: {
      encounters: vi.fn().mockResolvedValue({ data: [] }),
      observations: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      medications: vi.fn().mockResolvedValue({ data: [] }),
      serviceRequests: vi.fn().mockResolvedValue({ data: [] }),
      postCare: vi.fn().mockResolvedValue(null),
    },
    aiTeam: {
      generateSoap: vi.fn().mockRejectedValue(new Error("offline")),
      extractChecklist: vi.fn().mockResolvedValue({ items: [] }),
    },
  },
  ApiError: class ApiError extends Error {},
}));

class FakeEventSource {
  close(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

function renderShell(patientId: string | null): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <SullyProvider patientId={patientId} autoStream={false}>
        <TimelinePane />
        <AiTeamDrawer />
      </SullyProvider>
    </MemoryRouter>,
  );
}

describe("C02 — live/demo dataset exclusivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("LIVE mode: no mock timeline entries render when the live record is empty", async () => {
    renderShell("pt-live");

    await waitFor(() => {
      expect(screen.getByTestId("timeline-empty-live")).toBeInTheDocument();
    });
    // the canned cardiology entries must not appear
    expect(screen.queryByText(/Cardiology clinic visit/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/HbA1c/i)).not.toBeInTheDocument();
  });

  it("LIVE mode: no mock orders render — the order list shows its empty state", async () => {
    renderShell("pt-live");

    await waitFor(() => {
      expect(screen.getByText(/No orders on this encounter/i)).toBeInTheDocument();
    });
    // mock order displays must not appear
    expect(screen.queryByText(/Electrocardiogram \(ECG\), 12 lead/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lipid profile/i)).not.toBeInTheDocument();
  });

  it("LIVE mode: the activity stream starts empty — no canned agent messages", () => {
    renderShell("pt-live");

    // INITIAL_MESSAGES canned content must not appear
    expect(screen.queryByText(/No NPHIES necessity findings/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No drug-interaction or dose-safety findings/i)).not.toBeInTheDocument();
  });

  it("DEMO mode (no patientId): mocks still render — offline demo intact", async () => {
    renderShell(null);

    // demo keeps the canned timeline
    await waitFor(() => {
      expect(screen.getByText(/Cardiology clinic visit/i)).toBeInTheDocument();
    });
    // and the mock orders
    expect(screen.getAllByText(/Electrocardiogram/i).length).toBeGreaterThan(0);
  });

  it("LIVE mode: a timeline fetch failure shows the error, never the mock", async () => {
    vi.mocked(api.patients.encounters).mockRejectedValue(new Error("db down"));
    renderShell("pt-live");

    await waitFor(() => {
      // the honest empty state (not a failure that falls back to mocks)
      const hasError = screen.queryByRole("status") != null;
      const hasEmpty = screen.queryByTestId("timeline-empty-live") != null;
      expect(hasError || hasEmpty).toBe(true);
    });
    expect(screen.queryByText(/Cardiology clinic visit/i)).not.toBeInTheDocument();
  });
});
