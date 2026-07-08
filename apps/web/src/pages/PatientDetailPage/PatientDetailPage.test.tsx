import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PatientDetailPage from "./PatientDetailPage";
import { CopilotProvider } from "../../context/CopilotContext";
import { api, ApiError } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: {
    patients: {
      get: vi.fn(),
      observations: vi.fn(),
      medications: vi.fn(),
      medicationReconciliation: vi.fn(),
      brief: vi.fn(),
      serviceRequests: vi.fn(),
    },
    handoff: {
      generatePatient: vi.fn(),
    },
  },
  ApiError: class extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

const mockGet = api.patients.get as ReturnType<typeof vi.fn>;
const mockObs = api.patients.observations as ReturnType<typeof vi.fn>;
const mockMeds = api.patients.medications as ReturnType<typeof vi.fn>;
const mockRecon = api.patients.medicationReconciliation as ReturnType<typeof vi.fn>;
const mockBrief = api.patients.brief as ReturnType<typeof vi.fn>;
const mockServiceRequests = api.patients.serviceRequests as ReturnType<typeof vi.fn>;

function renderWithRoute(patientId = "patient-001", search = ""): ReturnType<typeof render> {
  return render(
    <CopilotProvider>
      <MemoryRouter initialEntries={[`/patients/${patientId}${search}`]}>
        <Routes>
          <Route path="/patients/:id" element={<PatientDetailPage />} />
        </Routes>
      </MemoryRouter>
    </CopilotProvider>,
  );
}

describe("PatientDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockObs.mockResolvedValue({ data: [], next_cursor: null, total: null });
    mockMeds.mockResolvedValue({ data: [], next_cursor: null, total: null });
    mockRecon.mockResolvedValue(null);
    // Keep the auxiliary panels in their loading state — these specs cover
    // the page shell, header, and lab panel only.
    mockBrief.mockReturnValue(new Promise(() => {}));
    mockServiceRequests.mockReturnValue(new Promise(() => {}));
  });

  it("shows loading initially", () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    renderWithRoute();
    expect(screen.getByText(/loading patient record/i)).toBeInTheDocument();
  });

  it("renders patient header when loaded", async () => {
    mockGet.mockResolvedValue({
      id: "patient-001",
      mrn: "MRN-006",
      display_name: "Omar Fakename-Al-Dossary",
      date_of_birth: "1978-01-20",
      sex: "male",
      preferred_language: "ar",
      ward: "Ward-4A",
      allergies: [],
      conditions: [],
    });

    renderWithRoute();

    await waitFor(() => {
      expect(screen.getByText("Omar Fakename-Al-Dossary")).toBeInTheDocument();
    });
    expect(screen.getByText("MRN-006")).toBeInTheDocument();
  });

  it("shows PATIENT_OUT_OF_SCOPE message on 403", async () => {
    mockGet.mockRejectedValue(
      new ApiError(403, "PATIENT_OUT_OF_SCOPE", "Patient is not within your care scope"),
    );

    renderWithRoute("out-of-scope-id");

    await waitFor(() => {
      expect(screen.getByText(/not within your care scope/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/PATIENT_OUT_OF_SCOPE/i)).toBeInTheDocument();
  });

  it("does not display color-coding or severity words in lab panel (Patient File view)", async () => {
    mockGet.mockResolvedValue({
      id: "patient-001",
      mrn: "MRN-006",
      display_name: "Test Patient",
      date_of_birth: "1978-01-20",
      sex: "male",
      preferred_language: "ar",
      ward: null,
      allergies: [],
      conditions: [],
    });

    mockObs.mockResolvedValue({
      data: [
        {
          id: "obs-001",
          category: "laboratory",
          code: "2160-0",
          code_display: "Creatinine",
          value_numeric: 168,
          value_text: null,
          unit: "μmol/L",
          ref_range_low: 59,
          ref_range_high: 104,
          ref_range_text: null,
          effective_at: "2025-06-01T10:00:00Z",
        },
      ],
      next_cursor: null,
      total: null,
    });

    // Lab data only renders in the Patient File (chart) view — the
    // default landing view is now the Copilot workspace.
    renderWithRoute("patient-001", "?view=chart");

    await waitFor(() => {
      expect(screen.getByText("Creatinine")).toBeInTheDocument();
    });

    // Value shown as plain text
    expect(screen.getByText("168 μmol/L")).toBeInTheDocument();

    // No severity labels in the DOM
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/\bcritical\b/i);
    expect(body).not.toMatch(/\babnormal\b/i);
    expect(body).not.toMatch(/\bworsening\b/i);
    expect(body).not.toMatch(/\bimproving\b/i);
    expect(body).not.toMatch(/\bconcerning\b/i);
  });
});
