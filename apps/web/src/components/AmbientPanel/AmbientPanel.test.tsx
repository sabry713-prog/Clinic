/**
 * AmbientPanel unit tests.
 *
 * - Start recording is disabled until consent is acknowledged
 * - Records -> transcribes -> shows raw transcript for review
 * - Structures the transcript into sections; every rendered section's text is
 *   a substring of the raw transcript (the verbatim guarantee, exercised at
 *   the UI level)
 * - Creates a draft from confirmed sections and notifies the parent
 * - Does not record, structure, or create a draft without explicit user action
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AmbientPanel from "./AmbientPanel";
import { api } from "../../lib/api";
import type { SegmentResult, DocumentDraft } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: {
    patients: {
      transcribe: vi.fn(),
      createDraft: vi.fn(),
    },
    ambient: {
      segment: vi.fn(),
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

const mockTranscribe = vi.mocked(api.patients.transcribe);
const mockCreateDraft = vi.mocked(api.patients.createDraft);
const mockSegment = vi.mocked(api.ambient.segment);

const TRANSCRIPT = "Patient reports a cough for three days. I think this is bronchitis. Start amoxicillin.";

const SEGMENT_RESULT: SegmentResult = {
  sections: [
    { key: "chief_complaint", text: "Patient reports a cough for three days." },
    { key: "assessment", text: "I think this is bronchitis." },
    { key: "plan", text: "Start amoxicillin." },
  ],
  unclassified_text: "",
  retries: 0,
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
  Object.defineProperty(window, "MediaRecorder", { value: FakeMediaRecorder, writable: true });
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
    writable: true,
  });
  // jsdom lacks FileReader.readAsDataURL producing real base64; stub it minimally.
  Object.defineProperty(window, "FileReader", {
    value: class {
      onloadend: (() => void) | null = null;
      result = "data:audio/webm;base64,ZmFrZQ==";
      readAsDataURL(): void { this.onloadend?.(); }
    },
    writable: true,
  });
});

async function recordAndTranscribe(): Promise<void> {
  await userEvent.click(screen.getByTestId("consent-checkbox"));
  await userEvent.click(screen.getByTestId("start-recording-btn"));
  await waitFor(() => expect(screen.getByTestId("stop-recording-btn")).toBeInTheDocument());
  await userEvent.click(screen.getByTestId("stop-recording-btn"));
  await waitFor(() => expect(screen.getByTestId("raw-transcript")).toBeInTheDocument());
}

describe("AmbientPanel", () => {
  it("start recording is disabled until consent is acknowledged", () => {
    render(<AmbientPanel patientId="patient-001" onDraftCreated={vi.fn()} />);
    expect(screen.getByTestId("start-recording-btn")).toBeDisabled();
  });

  it("consent checkbox enables the start button", async () => {
    render(<AmbientPanel patientId="patient-001" onDraftCreated={vi.fn()} />);
    await userEvent.click(screen.getByTestId("consent-checkbox"));
    expect(screen.getByTestId("start-recording-btn")).not.toBeDisabled();
  });

  it("records, transcribes, and shows the raw transcript for review", async () => {
    mockTranscribe.mockResolvedValueOnce({ text: TRANSCRIPT, raw_text: TRANSCRIPT, engine: "stub", reformat: "light" });
    render(<AmbientPanel patientId="patient-001" onDraftCreated={vi.fn()} />);
    await recordAndTranscribe();
    expect(screen.getByTestId("raw-transcript").textContent).toBe(TRANSCRIPT);
    expect(mockTranscribe).toHaveBeenCalledWith("patient-001", expect.any(String), "en");
  });

  it("structures the transcript and every rendered section is a substring of it", async () => {
    mockTranscribe.mockResolvedValueOnce({ text: TRANSCRIPT, raw_text: TRANSCRIPT, engine: "stub", reformat: "light" });
    mockSegment.mockResolvedValueOnce(SEGMENT_RESULT);
    render(<AmbientPanel patientId="patient-001" onDraftCreated={vi.fn()} />);
    await recordAndTranscribe();
    await userEvent.click(screen.getByTestId("structure-note-btn"));
    await waitFor(() => expect(screen.getByTestId("section-chief_complaint")).toBeInTheDocument());

    for (const key of ["chief_complaint", "assessment", "plan"]) {
      const value = (screen.getByTestId(`section-${key}`) as HTMLTextAreaElement).value;
      if (value) expect(TRANSCRIPT).toContain(value);
    }
  });

  it("creates a draft from confirmed sections and notifies the parent", async () => {
    mockTranscribe.mockResolvedValueOnce({ text: TRANSCRIPT, raw_text: TRANSCRIPT, engine: "stub", reformat: "light" });
    mockSegment.mockResolvedValueOnce(SEGMENT_RESULT);
    mockCreateDraft.mockResolvedValueOnce({ id: "draft-1" } as unknown as DocumentDraft);
    const onDraftCreated = vi.fn();
    render(<AmbientPanel patientId="patient-001" onDraftCreated={onDraftCreated} />);
    await recordAndTranscribe();
    await userEvent.click(screen.getByTestId("structure-note-btn"));
    await waitFor(() => expect(screen.getByTestId("create-draft-btn")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("create-draft-btn"));

    await waitFor(() => expect(onDraftCreated).toHaveBeenCalled());
    expect(mockCreateDraft).toHaveBeenCalledWith(
      "patient-001",
      "encounter_note",
      "en",
      "general",
      expect.objectContaining({ transcript: TRANSCRIPT }),
    );
  });

  it("does not record, structure, or create a draft without explicit user action", () => {
    render(<AmbientPanel patientId="patient-001" onDraftCreated={vi.fn()} />);
    expect(mockTranscribe).not.toHaveBeenCalled();
    expect(mockSegment).not.toHaveBeenCalled();
    expect(mockCreateDraft).not.toHaveBeenCalled();
    expect(screen.queryByTestId("raw-transcript")).not.toBeInTheDocument();
  });
});
