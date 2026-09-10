/**
 * ServiceRequestPanel unit tests — focused on the quick-entry addition:
 * - Typed text is matched against the catalog and rendered as a candidate card
 * - Confirming a quick-entry candidate passes the typed/dictated text through
 *   as adHocText so the server can re-derive it
 * - The mic button drives the same shared dictation mechanism as Draft/Ambient
 *   (record -> transcribe -> insert into the quick-entry box)
 * - Nothing is created without an explicit Confirm click
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ServiceRequestPanel from "./ServiceRequestPanel";
import { api } from "../../lib/api";
import type { ServiceCandidate, ServiceRequestItem } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: {
    patients: {
      serviceRequests: vi.fn(),
      serviceRequestCandidates: vi.fn(),
      matchQuickEntry: vi.fn(),
      createServiceRequests: vi.fn(),
      transcribe: vi.fn(),
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

const mockServiceRequests = vi.mocked(api.patients.serviceRequests);
const mockMatchQuickEntry = vi.mocked(api.patients.matchQuickEntry);
const mockCreateServiceRequests = vi.mocked(api.patients.createServiceRequests);
const mockTranscribe = vi.mocked(api.patients.transcribe);
const mockHisTransmissions = vi.mocked(api.patients.hisTransmissions);

const CHEST_XRAY: ServiceCandidate = {
  category: "imaging",
  code_system: "http://snomed.info/sct",
  code: "399208008",
  code_display: "Chest X-ray",
  source_type: "dictated_quick_entry",
  source_document_id: null,
  source_excerpt: "chest x-ray",
};

class FakeMediaRecorder {
  static isTypeSupported(): boolean { return true; }
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: MediaStream) { /* no-op */ }
  start(): void {
    this.ondataavailable?.({ data: new Blob(["fake-audio"], { type: "audio/webm" }) });
  }
  stop(): void {
    this.onstop?.();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockServiceRequests.mockResolvedValue({ data: [] as ServiceRequestItem[] });
  mockHisTransmissions.mockResolvedValue({ data: [] });
  Object.defineProperty(window, "MediaRecorder", { value: FakeMediaRecorder, writable: true });
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
    writable: true,
  });
  Object.defineProperty(window, "FileReader", {
    value: class {
      onloadend: (() => void) | null = null;
      result = "data:audio/webm;base64,ZmFrZQ==";
      readAsDataURL(): void { this.onloadend?.(); }
    },
    writable: true,
  });
});

describe("ServiceRequestPanel — quick order entry", () => {
  it("matches typed text against the catalog and renders a confirm/dismiss card", async () => {
    mockMatchQuickEntry.mockResolvedValueOnce({ data: [CHEST_XRAY] });
    render(<ServiceRequestPanel patientId="patient-001" />);

    await userEvent.type(screen.getByPlaceholderText(/chest x-ray and cbc/i), "chest x-ray");
    await userEvent.click(screen.getByRole("button", { name: /match/i }));

    await waitFor(() => expect(screen.getByText("Chest X-ray")).toBeInTheDocument());
    expect(mockMatchQuickEntry).toHaveBeenCalledWith("patient-001", "chest x-ray");
  });

  it("confirming a quick-entry card passes the typed text through as adHocText", async () => {
    mockMatchQuickEntry.mockResolvedValueOnce({ data: [CHEST_XRAY] });
    mockCreateServiceRequests.mockResolvedValueOnce({ data: [] });
    render(<ServiceRequestPanel patientId="patient-001" />);

    await userEvent.type(screen.getByPlaceholderText(/chest x-ray and cbc/i), "chest x-ray");
    await userEvent.click(screen.getByRole("button", { name: /match/i }));
    await waitFor(() => expect(screen.getByText("Chest X-ray")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() =>
      expect(mockCreateServiceRequests).toHaveBeenCalledWith("patient-001", [CHEST_XRAY], "chest x-ray"),
    );
    // Confirmed card is removed from the list.
    await waitFor(() => expect(screen.queryByText("Chest X-ray")).not.toBeInTheDocument());
  });

  it("dictating into the quick-entry box inserts the transcribed text via the shared mic mechanism", async () => {
    mockTranscribe.mockResolvedValueOnce({ text: "chest x-ray", raw_text: "chest x-ray", engine: "stub", reformat: "light" });
    render(<ServiceRequestPanel patientId="patient-001" />);

    const input = screen.getByPlaceholderText(/chest x-ray and cbc/i) as HTMLInputElement;
    await userEvent.click(screen.getByRole("button", { name: "🎙" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /stop/i }));

    await waitFor(() => expect(input.value).toContain("chest x-ray"));
    expect(mockTranscribe).toHaveBeenCalledWith("patient-001", expect.any(String), "en");
  });

  it("does not match or create anything without explicit user action", () => {
    render(<ServiceRequestPanel patientId="patient-001" />);
    expect(mockMatchQuickEntry).not.toHaveBeenCalled();
    expect(mockCreateServiceRequests).not.toHaveBeenCalled();
  });
});

describe("ServiceRequestPanel — SOAP draft suggestions", () => {
  const SOAP_STORE = {
    soap: {
      subjective: "patient suffered from severe abdominal pain",
      objective: "patient with stomach bloating",
      assessment: "intestinal obstruction",
      plan: "colonoscopy and some labs test before operation",
    },
  };

  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.mocked(api.patients.serviceRequests).mockResolvedValue({ data: [] });
  });

  it("shows the SOAP-suggest button when an encounter SOAP draft exists", () => {
    sessionStorage.setItem("sully.scribe.pt-1", JSON.stringify(SOAP_STORE));
    render(<ServiceRequestPanel patientId="pt-1" />);
    expect(screen.getByRole("button", { name: /Suggest orders from this encounter's SOAP draft/i })).toBeInTheDocument();
  });

  it("hides the button when there is no draft", () => {
    render(<ServiceRequestPanel patientId="pt-1" />);
    expect(screen.queryByRole("button", { name: /SOAP draft/i })).not.toBeInTheDocument();
  });

  it("matches candidates from the SOAP text and labels the queue honestly", async () => {
    sessionStorage.setItem("sully.scribe.pt-1", JSON.stringify(SOAP_STORE));
    const candidate: ServiceCandidate = {
      code: "abc", code_display: "Colonoscopy", category: "procedure",
      source_type: "dictated_quick_entry", source_excerpt: "colonoscopy",
    } as unknown as ServiceCandidate;
    vi.mocked(api.patients.matchQuickEntry).mockResolvedValue({ data: [candidate] });

    render(<ServiceRequestPanel patientId="pt-1" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Suggest orders from this encounter's SOAP draft/i }));

    await waitFor(() => {
      expect(api.patients.matchQuickEntry).toHaveBeenCalledWith("pt-1", expect.stringContaining("colonoscopy"));
    });
    expect(await screen.findByText(/matched from this encounter's SOAP draft/i)).toBeInTheDocument();
    expect(screen.getByText("Colonoscopy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm", exact: true })).toBeInTheDocument();
  });
});
