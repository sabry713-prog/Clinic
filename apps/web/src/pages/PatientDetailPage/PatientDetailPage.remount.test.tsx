import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import PatientDetailPage from "./PatientDetailPage";
import { CopilotProvider } from "../../context/CopilotContext";
import { api, ApiError } from "../../lib/api";

/**
 * C02: a mounted shell must not keep the previous patient's dataset. The fix is
 * `key={patientId}` on `<CortexShell>` in PatientDetailPage, and this is the test that
 * proves it -- the earlier attempt was deleted rather than left red, so the fix has been
 * shipped-but-unproven until now.
 *
 * It is deterministic on purpose: no timers, no waiting on a race. The mocked shell
 * captures its identity once per *mount* (a useState initializer), so a remount yields a
 * new value while an ordinary re-render keeps the old one -- and the control test below
 * proves exactly that, which is what makes the first assertion mean "remounted" rather
 * than "rendered again".
 */
vi.mock("../../components/layout/CortexShell", async () => {
  // Hoisting-safe: the factory runs before this module's imports, so nothing here may
  // reference a top-level binding, and JSX would need the runtime that is not up yet.
  const { useState, createElement } = await import("react");
  let mounts = 0;
  return {
    default: () => {
      const [id] = useState(() => ++mounts);
      return createElement("div", { "data-testid": "shell-mount" }, String(id));
    },
  };
});

vi.mock("../../lib/api", () => ({
  api: {
    patients: {
      get: vi.fn(),
      observations: vi.fn(),
      medications: vi.fn(),
      medicationReconciliation: vi.fn(),
      insurance: vi.fn().mockResolvedValue({ covers: [], last_eligibility: null }),
      brief: vi.fn(),
      sinceLastVisit: vi.fn(),
      serviceRequests: vi.fn(),
      encounters: vi.fn(),
    },
    handoff: { generatePatient: vi.fn() },
  },
  ApiError: class extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

const asMock = (f: unknown) => f as ReturnType<typeof vi.fn>;

function primeApi(): void {
  asMock(api.patients.get).mockImplementation(async (id: string) => ({
    id,
    display_name: `Patient ${id}`,
    mrn: `MRN-${id}`,
  }));
  asMock(api.patients.observations).mockResolvedValue({ data: [], total: 0 });
  asMock(api.patients.medications).mockResolvedValue({ data: [] });
  asMock(api.patients.medicationReconciliation).mockResolvedValue({ items: [] });
  asMock(api.patients.brief).mockResolvedValue({ text: "brief" });
  asMock(api.patients.sinceLastVisit).mockResolvedValue({ items: [] });
  asMock(api.patients.serviceRequests).mockResolvedValue({ data: [] });
  asMock(api.patients.encounters).mockResolvedValue({ data: [] });
  asMock(api.handoff.generatePatient).mockResolvedValue({ text: "handoff" });
}

/** A control the test can click, so navigation happens without unmounting the page. */
function GoTo({ id }: { id: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(`/patients/${id}?view=encounter`)}>
      go-{id}
    </button>
  );
}

function renderPage(patientId: string): ReturnType<typeof render> {
  return render(
    <CopilotProvider>
      <MemoryRouter initialEntries={[`/patients/${patientId}?view=encounter`]}>
        <Routes>
          <Route
            path="/patients/:id"
            element={
              <>
                <PatientDetailPage />
                <GoTo id="p2" />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </CopilotProvider>,
  );
}

describe("C02: the shell is remounted when the routed patient changes", () => {
  it("gives the new patient a fresh mount, not the previous patient's", async () => {
    primeApi();
    renderPage("p1");
    const first = await screen.findByTestId("shell-mount");
    const firstId = first.textContent;
    expect(firstId).toBeTruthy();

    (await screen.findByText("go-p2")).click();

    await waitFor(async () => {
      const now = await screen.findByTestId("shell-mount");
      expect(now.textContent).not.toBe(firstId);
    });
  });

  it("keeps the same mount across a plain re-render (so the test above means what it says)", async () => {
    primeApi();
    const { rerender } = renderPage("p1");
    const first = await screen.findByTestId("shell-mount");
    const firstId = first.textContent;

    rerender(
      <CopilotProvider>
        <MemoryRouter initialEntries={["/patients/p1?view=encounter"]}>
          <Routes>
            <Route
              path="/patients/:id"
              element={
                <>
                  <PatientDetailPage />
                  <GoTo id="p2" />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </CopilotProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("shell-mount").textContent).toBe(firstId);
    });
  });
});
