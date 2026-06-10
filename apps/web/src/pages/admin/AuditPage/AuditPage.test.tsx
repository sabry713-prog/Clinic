import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AuditPage from "./AuditPage";
import { api } from "../../../lib/api";

jest.mock("../../../lib/api", () => ({
  api: {
    admin: {
      listAudit: jest.fn(),
      verifyAudit: jest.fn(),
    },
  },
  ApiError: class extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

const mockEvents = [
  {
    id: "evt-1",
    ts: "2026-06-10T10:00:00Z",
    actor: { id: "user-1", display_name: "Dr. Ahmed", role: "physician" },
    action: "PATIENT_VIEW",
    target_type: "patient",
    target_id: "patient-uuid-1",
    outcome: "SUCCESS",
    metadata_json: {},
    request_id: "req-1",
  },
];

const mockVerifyResult = {
  passed: true,
  events_verified: 100,
  violations: [],
  started_at: "2026-06-10T10:00:00Z",
  finished_at: "2026-06-10T10:00:01Z",
};

describe("AuditPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders filter form", () => {
    render(<AuditPage />);

    expect(screen.getByText("Audit Log")).toBeInTheDocument();
    expect(screen.getByText("Filters")).toBeInTheDocument();
    expect(screen.getByLabelText("Action")).toBeInTheDocument();
    expect(screen.getByLabelText("Outcome")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("User UUID")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Resource UUID")).toBeInTheDocument();
  });

  it("shows results table after search", async () => {
    (api.admin.listAudit as jest.Mock).mockResolvedValue({
      data: mockEvents,
      pagination: { next_cursor: null, has_more: false },
    });

    render(<AuditPage />);
    fireEvent.click(screen.getByText("Search"));

    await waitFor(() => {
      expect(screen.getByText("PATIENT_VIEW")).toBeInTheDocument();
    });

    expect(screen.getByText("Dr. Ahmed")).toBeInTheDocument();
    expect(screen.getByText("SUCCESS")).toBeInTheDocument();
  });

  it("verify button calls api and shows passed result", async () => {
    (api.admin.verifyAudit as jest.Mock).mockResolvedValue(mockVerifyResult);

    render(<AuditPage />);
    fireEvent.click(screen.getByText("Verify Integrity"));

    await waitFor(() => {
      expect(screen.getByText(/Integrity check: Passed/)).toBeInTheDocument();
    });

    expect(screen.getByText(/Events verified: 100/)).toBeInTheDocument();
    expect(api.admin.verifyAudit).toHaveBeenCalledTimes(1);
  });

  it("shows failed result with violations", async () => {
    (api.admin.verifyAudit as jest.Mock).mockResolvedValue({
      passed: false,
      events_verified: 50,
      violations: [{ event_id: "evt-bad", reason: "hash_self mismatch" }],
      started_at: "2026-06-10T10:00:00Z",
      finished_at: "2026-06-10T10:00:01Z",
    });

    render(<AuditPage />);
    fireEvent.click(screen.getByText("Verify Integrity"));

    await waitFor(() => {
      expect(screen.getByText(/Integrity check: Failed/)).toBeInTheDocument();
    });

    expect(screen.getByText(/hash_self mismatch/)).toBeInTheDocument();
  });
});
