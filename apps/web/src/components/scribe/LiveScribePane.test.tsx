/**
 * Tests for the live scribe pane.
 *
 * Audio capture and the orchestrator are both mocked — no microphone, no
 * network. What matters here: the pane degrades honestly when the scribe
 * service is unavailable or policy blocks it, and manual edits survive.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LiveScribePane from "./LiveScribePane";
import * as scribeClient from "./scribeClient";
import * as audioStream from "../../services/audio_stream";

function mockStream() {
  const handle = { stop: vi.fn(), kind: "fixture" as const };
  let cbs: audioStream.AudioStreamCallbacks = {};
  vi.spyOn(audioStream, "startAudioStream").mockImplementation(async (_o, callbacks) => {
    cbs = callbacks;
    return handle;
  });
  return { handle, emit: (text: string) => cbs.onChunk?.({ text, speaker: "clinician", atMs: 0, isFinal: true }) };
}

beforeEach(() => {
  vi.spyOn(audioStream, "isMicrophoneSupported").mockReturnValue(true);
  vi.spyOn(scribeClient, "isOrchestratorUp").mockResolvedValue(true);
  vi.spyOn(scribeClient, "openSession").mockResolvedValue("sess-1");
  vi.spyOn(scribeClient, "fetchChecklist").mockResolvedValue([]);
});
afterEach(() => { vi.restoreAllMocks(); });

describe("LiveScribePane — layout", () => {
  it("renders the four SOAP fields", () => {
    render(<LiveScribePane />);
    for (const l of ["Subjective", "Objective", "Assessment", "Plan"]) {
      expect(screen.getByLabelText(l)).toBeInTheDocument();
    }
  });

  it("offers sample replay so it works without a microphone", () => {
    render(<LiveScribePane />);
    expect(screen.getByRole("button", { name: /replay sample/i })).toBeInTheDocument();
  });

  it("disables Record when the browser has no speech API", () => {
    vi.spyOn(audioStream, "isMicrophoneSupported").mockReturnValue(false);
    render(<LiveScribePane />);
    expect(screen.getByRole("button", { name: /record/i })).toBeDisabled();
  });

  it("shows an empty-state hint for the checklist", () => {
    render(<LiveScribePane />);
    expect(screen.getByText(/appear here when a symptom is mentioned/i)).toBeInTheDocument();
  });
});

describe("LiveScribePane — capture and structuring", () => {
  it("streams transcript text into the pane", async () => {
    const s = mockStream();
    vi.spyOn(scribeClient, "structureTranscript").mockResolvedValue({
      soap: { subjective: "Chest tightness on exertion.", objective: "", assessment: "", plan: "" },
      changed: ["subjective"],
      checklist: [],
    });

    render(<LiveScribePane />);
    fireEvent.click(screen.getByRole("button", { name: /replay sample/i }));
    await waitFor(() => expect(audioStream.startAudioStream).toHaveBeenCalled());

    s.emit("I get chest pain when I climb stairs.");
    await waitFor(() =>
      expect(screen.getByText(/chest pain when I climb stairs/i)).toBeInTheDocument(),
    );
  });

  it("fills and highlights the SOAP section that changed", async () => {
    const s = mockStream();
    vi.spyOn(scribeClient, "structureTranscript").mockResolvedValue({
      soap: { subjective: "Chest tightness on exertion.", objective: "", assessment: "", plan: "" },
      changed: ["subjective"],
      checklist: [],
    });

    render(<LiveScribePane />);
    fireEvent.click(screen.getByRole("button", { name: /replay sample/i }));
    await waitFor(() => expect(audioStream.startAudioStream).toHaveBeenCalled());
    s.emit("chest pain on exertion");

    await waitFor(
      () => expect((screen.getByLabelText("Subjective") as HTMLTextAreaElement).value)
        .toBe("Chest tightness on exertion."),
      { timeout: 4000 },
    );
    expect(screen.getByText("updated")).toBeInTheDocument();
  });

  it("surfaces triggered checklist items", async () => {
    const s = mockStream();
    vi.spyOn(scribeClient, "structureTranscript").mockResolvedValue({
      soap: { subjective: "", objective: "", assessment: "", plan: "" },
      changed: [],
      checklist: [{ symptom: "chest pain", label: "Record vital signs including blood pressure", done: false }],
    });

    render(<LiveScribePane />);
    fireEvent.click(screen.getByRole("button", { name: /replay sample/i }));
    await waitFor(() => expect(audioStream.startAudioStream).toHaveBeenCalled());
    s.emit("chest pain");

    await waitFor(
      () => expect(screen.getByText(/Record vital signs/i)).toBeInTheDocument(),
      { timeout: 4000 },
    );
  });
});

describe("LiveScribePane — honest degradation", () => {
  it("warns, but keeps capturing, when the scribe service is down", async () => {
    vi.spyOn(scribeClient, "isOrchestratorUp").mockResolvedValue(false);
    mockStream();

    render(<LiveScribePane />);
    fireEvent.click(screen.getByRole("button", { name: /replay sample/i }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/not running/i));
    // Capture still started despite the warning.
    expect(audioStream.startAudioStream).toHaveBeenCalled();
  });

  it("distinguishes a policy block from a service fault", async () => {
    const s = mockStream();
    vi.spyOn(scribeClient, "structureTranscript").mockRejectedValue(
      new scribeClient.ScribeError("Refusing to send patient data externally", 403, true),
    );

    render(<LiveScribePane />);
    fireEvent.click(screen.getByRole("button", { name: /replay sample/i }));
    await waitFor(() => expect(audioStream.startAudioStream).toHaveBeenCalled());
    s.emit("chest pain");

    await waitFor(
      () => expect(screen.getByRole("status")).toHaveTextContent(/data-residency policy/i),
      { timeout: 4000 },
    );
  });

  it("keeps the transcript visible when structuring fails", async () => {
    const s = mockStream();
    vi.spyOn(scribeClient, "structureTranscript").mockRejectedValue(
      new scribeClient.ScribeError("upstream exploded", 502, false),
    );

    render(<LiveScribePane />);
    fireEvent.click(screen.getByRole("button", { name: /replay sample/i }));
    await waitFor(() => expect(audioStream.startAudioStream).toHaveBeenCalled());
    s.emit("patient reports chest pain");

    expect(await screen.findByText(/patient reports chest pain/i)).toBeInTheDocument();
  });
});

describe("LiveScribePane — clinician authorship", () => {
  it("does not overwrite a field the clinician has edited", async () => {
    const s = mockStream();
    const structure = vi.spyOn(scribeClient, "structureTranscript");
    structure.mockResolvedValue({
      soap: { subjective: "MODEL TEXT", objective: "", assessment: "", plan: "" },
      changed: ["subjective"],
      checklist: [],
    });

    render(<LiveScribePane />);
    const subjective = screen.getByLabelText("Subjective") as HTMLTextAreaElement;
    fireEvent.change(subjective, { target: { value: "Clinician's own wording" } });

    fireEvent.click(screen.getByRole("button", { name: /replay sample/i }));
    await waitFor(() => expect(audioStream.startAudioStream).toHaveBeenCalled());
    s.emit("chest pain");

    await waitFor(() => expect(structure).toHaveBeenCalled(), { timeout: 4000 });
    expect((screen.getByLabelText("Subjective") as HTMLTextAreaElement).value)
      .toBe("Clinician's own wording");
  });
});
