/**
 * RefillPanel unit tests — request -> cancel flow. Administrative only, no
 * dose/interaction checking anywhere in this component.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RefillPanel from "./RefillPanel";
import { api } from "../../lib/api";
import type { MedicationItem, RefillRequest } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: {
    patients: {
      medications: vi.fn(),
      refillRequests: vi.fn(),
      createRefillRequest: vi.fn(),
      cancelRefillRequest: vi.fn(),
      hisTransmissions: vi.fn(),
      transmitToHis: vi.fn(),
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

const mockMedications = vi.mocked(api.patients.medications);
const mockRefillRequests = vi.mocked(api.patients.refillRequests);
const mockCreateRefillRequest = vi.mocked(api.patients.createRefillRequest);
const mockCancelRefillRequest = vi.mocked(api.patients.cancelRefillRequest);
const mockHisTransmissions = vi.mocked(api.patients.hisTransmissions);

const METFORMIN: MedicationItem = {
  id: "med-1",
  medication_display: "Metformin 500mg",
  code: "854906",
  dose: "500mg",
  route: "Oral",
  frequency: "BID",
  status: "active",
  started_at: "2026-01-01T00:00:00Z",
  ended_at: null,
};

const REQUESTED: RefillRequest = {
  id: "refill-1",
  patient_id: "patient-001",
  medication_request_id: "med-1",
  medication_display: "Metformin 500mg",
  status: "requested",
  requested_by: "user-001",
  requested_at: "2026-07-10T00:00:00Z",
  pharmacy_note: null,
  updated_at: "2026-07-10T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockHisTransmissions.mockResolvedValue({ data: [] });
});

describe("RefillPanel", () => {
  it("shows an active medication with a Request refill button when no open request exists", async () => {
    mockMedications.mockResolvedValueOnce({ data: [METFORMIN], next_cursor: null, total: 1 });
    mockRefillRequests.mockResolvedValueOnce({ data: [] });
    render(<RefillPanel patientId="patient-001" />);

    await waitFor(() => expect(screen.getByText("Metformin 500mg")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /request refill/i })).toBeInTheDocument();
  });

  it("requesting a refill creates it and moves the medication out of the refillable list", async () => {
    mockMedications.mockResolvedValueOnce({ data: [METFORMIN], next_cursor: null, total: 1 });
    mockRefillRequests.mockResolvedValueOnce({ data: [] });
    mockCreateRefillRequest.mockResolvedValueOnce(REQUESTED);
    mockMedications.mockResolvedValueOnce({ data: [METFORMIN], next_cursor: null, total: 1 });
    mockRefillRequests.mockResolvedValueOnce({ data: [REQUESTED] });

    render(<RefillPanel patientId="patient-001" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /request refill/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /request refill/i }));

    expect(mockCreateRefillRequest).toHaveBeenCalledWith("patient-001", "med-1");
    await waitFor(() =>
      expect(screen.getByText("No active medications without an open refill request.")).toBeInTheDocument(),
    );
    expect(screen.getByText("Requested")).toBeInTheDocument();
  });

  it("cancelling a requested refill request calls the API and refreshes", async () => {
    mockMedications.mockResolvedValue({ data: [], next_cursor: null, total: 0 });
    mockRefillRequests.mockResolvedValueOnce({ data: [REQUESTED] });
    mockCancelRefillRequest.mockResolvedValueOnce({ ...REQUESTED, status: "cancelled" });
    mockRefillRequests.mockResolvedValueOnce({ data: [{ ...REQUESTED, status: "cancelled" }] });

    render(<RefillPanel patientId="patient-001" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(mockCancelRefillRequest).toHaveBeenCalledWith("patient-001", "refill-1");
    await waitFor(() => expect(screen.getByText("Cancelled")).toBeInTheDocument());
  });

  it("does not request or cancel anything without explicit user action", () => {
    mockMedications.mockResolvedValueOnce({ data: [METFORMIN], next_cursor: null, total: 1 });
    mockRefillRequests.mockResolvedValueOnce({ data: [] });
    render(<RefillPanel patientId="patient-001" />);
    expect(mockCreateRefillRequest).not.toHaveBeenCalled();
    expect(mockCancelRefillRequest).not.toHaveBeenCalled();
  });
});
