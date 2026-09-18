/**
 * Smart checklist auto-proposal (Sully-style): entries the clinician
 * mentions in dictation join the checklist automatically, tagged
 * "recommended", and can be removed (the deselect). Deterministic keyword
 * matching only — the system never recommends beyond the clinician's
 * own words.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { proposeChecklist, mergeChecklistItems, deriveChecklistDone, CortexProvider, useCortex, type ChecklistItem } from "./CortexContext";
import { api } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: {
    aiTeam: {
      generateSoap: vi.fn().mockRejectedValue(new Error("offline")),
      extractChecklist: vi.fn().mockResolvedValue({ items: [] }),
    },
    patients: {
      encounters: vi.fn().mockResolvedValue({ data: [] }),
      observations: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      medications: vi.fn().mockResolvedValue({ data: [] }),
      serviceRequests: vi.fn().mockResolvedValue({ data: [] }),
      postCare: vi.fn().mockResolvedValue(null),
    },
  },
  ApiError: class ApiError extends Error {},
}));
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

describe("Smart checklist auto-proposal — wiring (CortexProvider)", () => {
  class FakeEventSource {
    close(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  }

  function Driver({ lines }: { lines: readonly string[] }): null {
    const { appendTranscriptLine } = useCortex();
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
        <CortexProvider patientId="pt-1" autoStream={false}>
          <Driver lines={lines} />
          <AmbientScribePane />
        </CortexProvider>
      </MemoryRouter>,
    );
    return container;
  }

  beforeEach(() => {
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    // clearAllMocks in the previous teardown also clears implementations
    // registered via mockResolvedValue — re-prime the defaults each test.
    vi.mocked(api.aiTeam.extractChecklist).mockResolvedValue({ items: [] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    // clear calls only — restoreAllMocks would wipe the factory-level
    // mockResolvedValue implementations the next test depends on.
    vi.clearAllMocks();
  });

  it("earns the documentation ticks from the encounter, not from the fixture", () => {
    // The exact note used to test this by hand: written outside, pasted into the fields.
    const note = [
      "Chest tightness on exertion for two weeks. No pain at rest.",
      "BP 114/82, HR 74, SpO2 96%, Temp 37.1C, RR 14/min. Heart sounds NOT NORMAL, murmurs. Chest unclear.",
      "ECHO. And MRI. Follow up in one week",
    ].join(" ");

    const earned = deriveChecklistDone(note, false);
    expect(earned.has("c1")).toBe(true); // "for two weeks"
    expect(earned.has("c3")).toBe(true); // "heart sounds"
    // Vitals are observations; prose in a note cannot stand in for a recorded vital sign.
    expect(earned.has("c2")).toBe(false);
    expect(deriveChecklistDone(note, true).has("c2")).toBe(true);

    // A note with nothing to document earns nothing.
    expect(deriveChecklistDone("", false).size).toBe(0);
  });

  it("ticks what the pasted note documents, and leaves vitals to the record", async () => {
    const container = renderScribe([]);
    const textareas = container.querySelectorAll("textarea");
    fireEvent.change(textareas[0] as HTMLTextAreaElement, {
      target: { value: "Chest tightness on exertion for two weeks. No pain at rest." },
    });
    fireEvent.change(textareas[1] as HTMLTextAreaElement, {
      target: { value: "Heart sounds NOT NORMAL, murmurs. Chest unclear." },
    });
    // onset/duration + cardiovascular examination, and NOT vitals: the mocked API returns no
    // observations for this encounter, so the row stays open.
    await waitFor(() => {
      expect(screen.getByText(/^2\/6$/)).toBeInTheDocument();
    });
  });

  it("recommends from a note pasted into the SOAP fields with nothing dictated", async () => {
    // No dictation at all -- the workflow someone uses to try this feature out.
    const container = renderScribe([]);

    // SOAP_SECTIONS order is Subjective, Objective, Assessment, Plan.
    const plan = container.querySelectorAll("textarea")[3] as HTMLTextAreaElement;
    expect(plan).toBeTruthy();
    fireEvent.change(plan, { target: { value: "ECHO. And MRI. Follow up in one week" } });

    await waitFor(() => {
      expect(screen.getByText(/recommended from your note/i)).toBeInTheDocument();
    });
    // "Follow up in one week" matches the follow-up keyword, so that template row is tagged.
    expect(
      screen.getByRole("button", { name: "Remove recommended item: Arrange follow-up" }),
    ).toBeInTheDocument();
  });

  it("adds recommended entries as dictation mentions them, and removal dismisses", async () => {
    renderScribe([
      "Blood pressure is 148 over 92.",
      "Let's get an ECG and review your lipid profile.",
    ]);

    // template rows the dictation mentioned become tagged as suggested
    await waitFor(() => {
      expect(screen.getAllByTestId("checklist-recommended-tag").length).toBeGreaterThanOrEqual(3);
    });
    expect(screen.getByText(/recommended from your note/i)).toBeInTheDocument();

    // removing one suggested entry dismisses it for the encounter
    const remove = screen.getByRole("button", { name: "Remove recommended item: Order ECG" });
    fireEvent.click(remove);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Remove recommended item: Order ECG" })).not.toBeInTheDocument();
    });
    // the others remain
    expect(screen.getByRole("button", { name: "Remove recommended item: Review lipid profile" })).toBeInTheDocument();
  });

});

describe("mergeChecklistItems — LLM-proposal merge (pure)", () => {
  const TEMPLATE: readonly ChecklistItem[] = [
    { id: "c1", label: "Record vital signs", done: true },
    { id: "c4", label: "Order ECG", done: false },
  ];

  it("adds LLM-extracted items (e.g. paraphrased imaging) as suggested entries", () => {
    const merged = mergeChecklistItems(TEMPLATE, [
      { id: "llm-0-image-the-chest", label: "Image the chest", done: false, proposed: true },
    ], new Set());
    expect(merged).not.toBeNull();
    const added = merged!.find((i) => i.label === "Image the chest");
    expect(added?.proposed).toBe(true);
    expect(added?.done).toBe(false);
  });

  it("tags an existing template row instead of duplicating it", () => {
    const merged = mergeChecklistItems(TEMPLATE, [
      { id: "llm-1-order-ecg", label: "Order ECG", done: false, proposed: true },
    ], new Set());
    expect(merged!.filter((i) => i.label === "Order ECG")).toHaveLength(1);
    expect(merged!.find((i) => i.label === "Order ECG")?.proposed).toBe(true);
  });

  it("never resurrects a dismissed suggestion", () => {
    const merged = mergeChecklistItems(TEMPLATE, [
      { id: "llm-0-image-the-chest", label: "Image the chest", done: false, proposed: true },
    ], new Set(["llm-0-image-the-chest"]));
    expect(merged).toBeNull();
  });

  it("returns null when nothing changes (idempotent re-merge)", () => {
    const once = mergeChecklistItems(TEMPLATE, [
      { id: "llm-0-image-the-chest", label: "Image the chest", done: false, proposed: true },
    ], new Set())!;
    const twice = mergeChecklistItems(once, [
      { id: "llm-0-image-the-chest", label: "Image the chest", done: false, proposed: true },
    ], new Set());
    expect(twice).toBeNull();
  });
});
