import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PatientListPage from "./PatientListPage";
import { api } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: {
    patients: {
      list: vi.fn(),
    },
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

const mockList = api.patients.list as ReturnType<typeof vi.fn>;

describe("PatientListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    mockList.mockReturnValue(new Promise(() => {}));
    render(
      <MemoryRouter>
        <PatientListPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/loading patients/i)).toBeInTheDocument();
  });

  it("renders patient list when data loads", async () => {
    mockList.mockResolvedValue({
      data: [
        {
          id: "patient-uuid-001",
          mrn: "MRN-006",
          display_name: "Omar Fakename-Al-Dossary",
          date_of_birth: "1978-01-20",
          sex: "male",
          preferred_language: "ar",
          ward: "Ward-4A",
        },
      ],
      next_cursor: null,
      total: null,
    });

    render(
      <MemoryRouter>
        <PatientListPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Omar Fakename-Al-Dossary")).toBeInTheDocument();
    });

    expect(screen.getByText("MRN-006")).toBeInTheDocument();
    expect(screen.getByText("Ward-4A")).toBeInTheDocument();
  });

  it("shows empty state when no patients in scope", async () => {
    mockList.mockResolvedValue({ data: [], next_cursor: null, total: 0 });

    render(
      <MemoryRouter>
        <PatientListPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/no patients in your care scope/i)).toBeInTheDocument();
    });
  });
});
