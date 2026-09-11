/**
 * Smart checklist auto-proposal (Sully-style): entries the clinician
 * mentions in dictation join the checklist automatically, tagged
 * "suggested", and can be removed (the deselect). Deterministic keyword
 * matching only — the system never recommends beyond the clinician's
 * own words.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { proposeChecklist, SullyProvider, useSully } from "./SullyContext";
import AmbientScribePane from "./panes/AmbientScribePane";

describe("proposeChecklist — deterministic derivation", () => {
  it("derives items mentioned in the transcript (the canned demo wording)", () => {
    const hits = proposeChecklist(
      "Blood pressure is 148 over 92. Let's get an ECG and review your lipid profile, then follow up in a week.",
      "",
    );
    const labels = hits.map((h) => h.label);
    expect(labels).toContain("Record vital signs"); // "blood pressure"
    expect(labels).toContain("Order ECG"); // "ECG"
    expect(labels).toContain("Review lipid profile"); // "lipid"
    expect(labels).toContain("Arrange follow-up"); // "follow up"
    // every derived item is a not-yet-done suggestion
    for (const h of hits) {
      expect(h.done).toBe(false);
      expect(h.proposed).toBe(true);
    }
  });

  it("matches case-insensitively across transcript and SOAP text", () => {
    const hits = proposeChecklist("", "Plan: chest X-ray and referral to cardiology.");
    expect(hits.map((h) => h.label)).toEqual(expect.arrayContaining(["Order imaging", "Arrange referral"]));
  });

  it("proposes nothing for text with no catalog matches", () => {
    expect(proposeChecklist("nice weather today", "")).toEqual([]);
  });

  it("proposes nothing for empty input", () => {
    expect(proposeChecklist("", "")).toEqual([]);
  });
});

describe("Smart checklist auto-proposal — wiring (SullyProvider)", () => {
  class FakeEventSource {
    close(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  }

  function Driver({ lines }: { lines: readonly string[] }): null {
    const { appendTranscriptLine } = useSully();
    useEffect(() => {
      for (const l of lines) appendTranscriptLine(l);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  }

  function renderScribe(lines: readonly string[]): HTMLElement {
    // patientId routes the provider into live mode so the driver's lines
    // feed the live transcript (what the dictation hook uses).
    const { container } = render(
      <MemoryRouter>
        <SullyProvider patientId="pt-1" autoStream={false}>
          <Driver lines={lines} />
          <AmbientScribePane />
        </SullyProvider>
      </MemoryRouter>,
    );
    return container;
  }

  beforeEach(() => {
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    vi.mock("../../lib/api", () => ({
      api: { aiTeam: { generateSoap: vi.fn().mockRejectedValue(new Error("offline")) } },
      ApiError: class ApiError extends Error {},
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("adds suggested entries as dictation mentions them, and removal dismisses", async () => {
    renderScribe([
      "Blood pressure is 148 over 92.",
      "Let's get an ECG and review your lipid profile.",
    ]);

    // template rows the dictation mentioned become tagged as suggested
    await waitFor(() => {
      expect(screen.getAllByTestId("checklist-suggested-tag").length).toBeGreaterThanOrEqual(3);
    });
    expect(screen.getByText(/suggested from your dictation/i)).toBeInTheDocument();

    // removing one suggested entry dismisses it for the encounter
    const remove = screen.getByRole("button", { name: "Remove suggested item: Order ECG" });
    fireEvent.click(remove);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Remove suggested item: Order ECG" })).not.toBeInTheDocument();
    });
    // the others remain
    expect(screen.getByRole("button", { name: "Remove suggested item: Review lipid profile" })).toBeInTheDocument();
  });
});
