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
      condense: vi.fn(),
      extractTerms: vi.fn(),
    },
    interpreter: {
      translate: vi.fn(),
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
const mockCondense = vi.mocked(api.ambient.condense);
const mockTranslate = vi.mocked(api.interpreter.translate);
const mockExtractTerms = vi.mocked(api.ambient.extractTerms);

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
  // Fires automatically after every transcription (onDictationResult) --
  // default to an empty glossary so existing tests that don't care about term
  // extraction aren't affected by an unresolved mock.
  mockExtractTerms.mockResolvedValue({ terms: [], retries: 0 });
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

  it("offers a Condense button only for chief_complaint/history, never assessment/plan", async () => {
    mockTranscribe.mockResolvedValueOnce({ text: TRANSCRIPT, raw_text: TRANSCRIPT, engine: "stub", reformat: "light" });
    mockSegment.mockResolvedValueOnce(SEGMENT_RESULT);
    render(<AmbientPanel patientId="patient-001" onDraftCreated={vi.fn()} />);
    await recordAndTranscribe();
    await userEvent.click(screen.getByTestId("structure-note-btn"));
    await waitFor(() => expect(screen.getByTestId("section-chief_complaint")).toBeInTheDocument());

    expect(screen.getByTestId("condense-btn-chief_complaint")).toBeInTheDocument();
    expect(screen.getByTestId("condense-btn-history")).toBeInTheDocument();
    expect(screen.queryByTestId("condense-btn-assessment")).not.toBeInTheDocument();
    expect(screen.queryByTestId("condense-btn-plan")).not.toBeInTheDocument();
  });

  it("accepting a condensed suggestion replaces the section text and is passed to createDraft", async () => {
    mockTranscribe.mockResolvedValueOnce({ text: TRANSCRIPT, raw_text: TRANSCRIPT, engine: "stub", reformat: "light" });
    mockSegment.mockResolvedValueOnce(SEGMENT_RESULT);
    mockCondense.mockResolvedValueOnce({ text: "3-day cough.", condensed: true, retries: 0 });
    mockCreateDraft.mockResolvedValueOnce({ id: "draft-1" } as unknown as DocumentDraft);
    render(<AmbientPanel patientId="patient-001" onDraftCreated={vi.fn()} />);
    await recordAndTranscribe();
    await userEvent.click(screen.getByTestId("structure-note-btn"));
    await waitFor(() => expect(screen.getByTestId("section-chief_complaint")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("condense-btn-chief_complaint"));
    await waitFor(() => expect(screen.getByTestId("condense-suggestion-chief_complaint")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /use condensed version/i }));

    expect((screen.getByTestId("section-chief_complaint") as HTMLTextAreaElement).value).toBe("3-day cough.");

    await userEvent.click(screen.getByTestId("create-draft-btn"));
    await waitFor(() =>
      expect(mockCreateDraft).toHaveBeenCalledWith(
        "patient-001",
        "encounter_note",
        "en",
        "general",
        expect.objectContaining({ condensedKeys: ["chief_complaint"] }),
      ),
    );
  });

  it("discarding a condensed suggestion leaves the original section text untouched", async () => {
    mockTranscribe.mockResolvedValueOnce({ text: TRANSCRIPT, raw_text: TRANSCRIPT, engine: "stub", reformat: "light" });
    mockSegment.mockResolvedValueOnce(SEGMENT_RESULT);
    mockCondense.mockResolvedValueOnce({ text: "3-day cough.", condensed: true, retries: 0 });
    render(<AmbientPanel patientId="patient-001" onDraftCreated={vi.fn()} />);
    await recordAndTranscribe();
    await userEvent.click(screen.getByTestId("structure-note-btn"));
    await waitFor(() => expect(screen.getByTestId("section-chief_complaint")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("condense-btn-chief_complaint"));
    await waitFor(() => expect(screen.getByTestId("condense-suggestion-chief_complaint")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /keep original/i }));

    expect((screen.getByTestId("section-chief_complaint") as HTMLTextAreaElement).value).toBe(
      "Patient reports a cough for three days.",
    );
    expect(screen.queryByTestId("condense-suggestion-chief_complaint")).not.toBeInTheDocument();
  });

  it("auto-translates every section after structuring an Arabic transcript, and passes accepted translations to createDraft", async () => {
    mockTranscribe.mockResolvedValueOnce({ text: TRANSCRIPT, raw_text: TRANSCRIPT, engine: "stub", reformat: "light" });
    mockSegment.mockResolvedValueOnce(SEGMENT_RESULT);
    mockTranslate.mockResolvedValue({
      text: "English version.",
      fallback_message: null,
      prompt_template_version: "v1",
      blocklist_triggered: false,
      disclaimer: "Machine translation for bedside communication.",
    });
    mockCreateDraft.mockResolvedValueOnce({ id: "draft-1" } as unknown as DocumentDraft);
    render(<AmbientPanel patientId="patient-001" onDraftCreated={vi.fn()} />);

    await userEvent.selectOptions(screen.getByLabelText("Language"), "ar");
    await recordAndTranscribe();
    await userEvent.click(screen.getByTestId("structure-note-btn"));
    await waitFor(() => expect(screen.getByTestId("section-chief_complaint")).toBeInTheDocument());

    // Fires automatically -- no button click -- for every non-empty section.
    await waitFor(() => expect(mockTranslate).toHaveBeenCalledTimes(3));
    expect(mockTranslate).toHaveBeenCalledWith("patient-001", {
      text: "Patient reports a cough for three days.",
      sourceLanguage: "ar",
      targetLanguage: "en",
    });

    await waitFor(() => expect(screen.getByTestId("translation-preview-chief_complaint")).toBeInTheDocument());
    expect(screen.getByTestId("translation-preview-assessment")).toBeInTheDocument();
    // Assessment/Plan get a read-only preview, never an accept control.
    expect(screen.queryByTestId("use-translation-btn-assessment")).not.toBeInTheDocument();
    expect(screen.queryByTestId("use-translation-btn-plan")).not.toBeInTheDocument();

    // Accepting the translation never touches the editable textarea -- it
    // keeps showing the original-language text.
    await userEvent.click(screen.getByTestId("use-translation-btn-chief_complaint"));
    expect((screen.getByTestId("section-chief_complaint") as HTMLTextAreaElement).value).toBe(
      "Patient reports a cough for three days.",
    );

    await userEvent.click(screen.getByTestId("create-draft-btn"));
    await waitFor(() =>
      expect(mockCreateDraft).toHaveBeenCalledWith(
        "patient-001",
        "encounter_note",
        "ar",
        "general",
        expect.objectContaining({ translatedKeys: ["chief_complaint"] }),
      ),
    );
  });

  it("shows a read-only medical-terms glossary after transcription, alongside the raw transcript", async () => {
    mockTranscribe.mockResolvedValueOnce({ text: TRANSCRIPT, raw_text: TRANSCRIPT, engine: "stub", reformat: "light" });
    mockExtractTerms.mockResolvedValueOnce({
      terms: [
        { term: "cough", category: "symptom" },
        { term: "amoxicillin", category: "medication" },
      ],
      retries: 0,
    });
    render(<AmbientPanel patientId="patient-001" onDraftCreated={vi.fn()} />);
    await recordAndTranscribe();

    expect(mockExtractTerms).toHaveBeenCalledWith("patient-001", TRANSCRIPT, "en");
    await waitFor(() => expect(screen.getByTestId("medical-terms-glossary")).toBeInTheDocument());
    expect(screen.getByText("cough")).toBeInTheDocument();
    expect(screen.getByText("amoxicillin")).toBeInTheDocument();

    // Purely additive -- never touches the editable transcript/section flow.
    expect(screen.getByTestId("raw-transcript").textContent).toBe(TRANSCRIPT);
  });

  it("renders nothing when no medical terms are found", async () => {
    mockTranscribe.mockResolvedValueOnce({ text: TRANSCRIPT, raw_text: TRANSCRIPT, engine: "stub", reformat: "light" });
    mockExtractTerms.mockResolvedValueOnce({ terms: [], retries: 0 });
    render(<AmbientPanel patientId="patient-001" onDraftCreated={vi.fn()} />);
    await recordAndTranscribe();

    await waitFor(() => expect(mockExtractTerms).toHaveBeenCalled());
    expect(screen.queryByTestId("medical-terms-glossary")).not.toBeInTheDocument();
  });
});
