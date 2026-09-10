/**
 * Live-SOAP failure surfacing: when the auto-generation round-trip fails
 * (e.g. a network drop to the orchestrator/DeepSeek), the scribe pane must
 * show a visible notice instead of silently leaving the draft empty —
 * the exact gap found while testing a live recording whose transcript kept
 * growing but the SOAP never filled.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SullyProvider, useSully } from "./SullyContext";
import AmbientScribePane from "./panes/AmbientScribePane";

const { apiMock, generateSoapMock } = vi.hoisted(() => {
  // A callable, deeply-permissive stub: any property access returns another
  // callable stub whose calls resolve to an empty page — the provider's
  // live-patient fetches (timeline, encounters, post-care) run silently.
  const MOCK_FNS = new Set(["mock", "mockClear", "mockRejectedValue", "mockResolvedValue", "mockImplementation", "calls", "results", "_isMockFunction"]);
  const makeStub = (): unknown =>
    new Proxy(vi.fn().mockResolvedValue({ data: [], total: 0 }), {
      get(target, prop) {
        const record = target as unknown as Record<string | symbol, unknown>;
        if (MOCK_FNS.has(String(prop)) || prop in record) {
          return record[prop];
        }
        const child = makeStub();
        record[prop] = child;
        return child;
      },
    });
  const generateSoap = vi.fn();
  const root = makeStub() as Record<string, unknown>;
  const aiTeam = makeStub() as Record<string, unknown>;
  aiTeam["generateSoap"] = generateSoap;
  root["aiTeam"] = aiTeam;
  return { apiMock: root, generateSoapMock: generateSoap };
});

vi.mock("../../lib/api", () => ({ api: apiMock }));

/** Pushes three dictation lines into the live transcript on mount, which
 * crosses the auto-generation threshold (>= 3 lines). */
function TranscriptDriver(): null {
  const { appendTranscriptLine } = useSully();
  useEffect(() => {
    appendTranscriptLine("Patient reports chest tightness on exertion.");
    appendTranscriptLine("Blood pressure is 148 over 92.");
    appendTranscriptLine("Let's get an ECG.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function renderScribe(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <SullyProvider patientId="pt-1" autoStream={false}>
        <TranscriptDriver />
        <AmbientScribePane />
      </SullyProvider>
    </MemoryRouter>,
  );
}

// The provider opens an SSE agent stream when a patient is routed in;
// jsdom has no EventSource, so provide a quiet stand-in.
class FakeEventSource {
  close(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

describe("Ambient scribe — live SOAP failure notice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows the error notice when live SOAP generation fails", async () => {
    generateSoapMock.mockRejectedValue(new Error("network down"));
    renderScribe();

    // debounce is 2s after the transcript grows; advance inside act()
    // so the rejection -> setState -> re-render flushes into the DOM
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_600);
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(generateSoapMock).toHaveBeenCalled();
    const notice = screen.getByTestId("soap-error");
    expect(notice.textContent).toContain("unreachable");
  }, 10_000);

  it("keeps the transcript visible while the notice is shown", async () => {
    generateSoapMock.mockRejectedValue(new Error("network down"));
    renderScribe();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_600);
      await vi.advanceTimersByTimeAsync(100);
    });

    // the clinician's words are never lost when generation fails
    expect(screen.getByTestId("soap-error")).toBeInTheDocument();
    expect(screen.getByText(/chest tightness on exertion/)).toBeInTheDocument();
  }, 10_000);
});
