/**
 * PharmacyQueuePage unit tests — route -> fill flow, and deny with an
 * optional administrative note. Cross-patient but administrative-only
 * (identity + medication name + status + timestamps, no clinical content).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PharmacyQueuePage from "./PharmacyQueuePage";
import { api } from "../../lib/api";
import type { RefillQueueItem } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: {
    pharmacy: {
      refillQueue: vi.fn(),
      updateRefillStatus: vi.fn(),
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

const mockRefillQueue = vi.mocked(api.pharmacy.refillQueue);
const mockUpdateRefillStatus = vi.mocked(api.pharmacy.updateRefillStatus);

const REQUESTED_ITEM: RefillQueueItem = {
  id: "refill-1",
  patient_id: "patient-001",
  medication_request_id: "med-1",
  medication_display: "Metformin 500mg",
  status: "requested",
  requested_by: "user-001",
  requested_at: "2026-07-10T00:00:00Z",
  pharmacy_note: null,
  updated_at: "2026-07-10T00:00:00Z",
  patient_mrn: "MRN-010",
  patient_display_name: "Ahmad Fakename-Al-Bishi",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PharmacyQueuePage", () => {
  it("renders open requests with patient identity and medication name", async () => {
    mockRefillQueue.mockResolvedValueOnce({ data: [REQUESTED_ITEM] });
    render(<PharmacyQueuePage />);

    await waitFor(() => expect(screen.getByText("Metformin 500mg")).toBeInTheDocument());
    expect(screen.getByText(/Ahmad Fakename-Al-Bishi/)).toBeInTheDocument();
    expect(screen.getByText(/MRN-010/)).toBeInTheDocument();
  });

  it("shows an empty state when there are no open requests", async () => {
    mockRefillQueue.mockResolvedValueOnce({ data: [] });
    render(<PharmacyQueuePage />);
    await waitFor(() => expect(screen.getByText("No open refill requests")).toBeInTheDocument());
  });

  it("routing a requested item calls the API with status 'routed'", async () => {
    mockRefillQueue.mockResolvedValueOnce({ data: [REQUESTED_ITEM] });
    mockUpdateRefillStatus.mockResolvedValueOnce({ ...REQUESTED_ITEM, status: "routed" });
    mockRefillQueue.mockResolvedValueOnce({ data: [{ ...REQUESTED_ITEM, status: "routed" }] });

    render(<PharmacyQueuePage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /route/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /route/i }));

    expect(mockUpdateRefillStatus).toHaveBeenCalledWith("refill-1", "routed", undefined);
  });

  it("filling a routed item calls the API with status 'filled'", async () => {
    const routedItem = { ...REQUESTED_ITEM, status: "routed" as const };
    mockRefillQueue.mockResolvedValueOnce({ data: [routedItem] });
    mockUpdateRefillStatus.mockResolvedValueOnce({ ...routedItem, status: "filled" });
    mockRefillQueue.mockResolvedValueOnce({ data: [] });

    render(<PharmacyQueuePage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^fill$/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /^fill$/i }));

    expect(mockUpdateRefillStatus).toHaveBeenCalledWith("refill-1", "filled", undefined);
  });

  it("denying prompts for an optional note and sends it through", async () => {
    mockRefillQueue.mockResolvedValueOnce({ data: [REQUESTED_ITEM] });
    mockUpdateRefillStatus.mockResolvedValueOnce({ ...REQUESTED_ITEM, status: "denied" });
    mockRefillQueue.mockResolvedValueOnce({ data: [] });

    render(<PharmacyQueuePage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /deny/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /deny/i }));

    const textarea = await screen.findByPlaceholderText(/note \(optional\)/i);
    await userEvent.type(textarea, "Prescription expired per pharmacy records");
    await userEvent.click(screen.getByRole("button", { name: /confirm deny/i }));

    await waitFor(() =>
      expect(mockUpdateRefillStatus).toHaveBeenCalledWith(
        "refill-1",
        "denied",
        "Prescription expired per pharmacy records",
      ),
    );
  });

  it("does not update anything without explicit user action", () => {
    mockRefillQueue.mockResolvedValueOnce({ data: [REQUESTED_ITEM] });
    render(<PharmacyQueuePage />);
    expect(mockUpdateRefillStatus).not.toHaveBeenCalled();
  });
});
