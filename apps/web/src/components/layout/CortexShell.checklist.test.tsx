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
import { IMAGING_KEYWORDS, LAB_KEYWORDS } from "../../lib/clinicalVocabulary";
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

  it("proposes from a plan phrased the way a clinician types it", () => {
    // Typed straight into the Plan field during testing -- and the panel said nothing, because
    // the catalog knew "x-ray" but not "ultrasound", "culture" or the lab wording here.
    const hits = proposeChecklist(
      "",
      "kidney enzymes and urine culture and kidney ultrasound",
    );
    const labels = hits.map((h) => h.label);
    expect(labels).toContain("Review lab results"); // "urine culture" / "enzymes"
    expect(labels).toContain("Order imaging"); // "ultrasound"
    expect(labels).not.toContain("Order ECG"); // nothing cardiac was ordered
  });

  it("matches whole words, so short abbreviations cannot fire inside other words", () => {
    // "alt" is ALT. As a substring test it also lived inside "salt", "although" and
    // "alternative", which is why it had to be kept out of the vocabulary; the matcher requires
    // word boundaries now, so the abbreviation is safe to carry.
    expect(proposeChecklist("", "add salt to the diet").map((h) => h.label)).not.toContain("Review lab results");
    expect(proposeChecklist("", "ALT and AST are raised").map((h) => h.label)).toContain("Review lab results");
    // ...while an inflection of a real term still matches.
    expect(proposeChecklist("", "check lipids").map((h) => h.label)).toContain("Review lipid profile");
  });

  it("scans the whole vocabulary fast enough to run on every keystroke", () => {
    // The proposal runs on each note edit and the vocabulary is now several hundred phrases, so
    // an accidental per-call RegExp compilation or quadratic scan would be felt while typing.
    // The bound is deliberately loose: this catches a collapse, not a slow machine.
    const note =
      "Chest tightness on exertion for two weeks. BP 114/82, HR 74, SpO2 96%, Temp 37.1C. " +
      "Heart sounds not normal, murmurs. Kidney ultrasound and urine culture, follow up in a week.";
    const started = performance.now();
    for (let i = 0; i < 50; i += 1) proposeChecklist(note, note);
    const perScan = (performance.now() - started) / 50;
    expect(perScan).toBeLessThan(50);
  });

  it("carries the generated vocabulary, and none of its unsafe short forms", () => {
    // Imaging modalities come from DICOM PS3.16 CID 29 and the labs from LOINC Top 2000+
    // (rank order). See tools/build_clinical_vocabulary.py.
    expect(IMAGING_KEYWORDS).toContain("ultrasound");
    expect(IMAGING_KEYWORDS).toContain("mri");
    expect(LAB_KEYWORDS).toContain("urine culture");
    expect(LAB_KEYWORDS).toContain("hba1c");
    // Two-character source codes are exactly the substring hazards above: "us" lives in "pus"
    // and "usual", "ct" in "product". They are deliberately absent.
    for (const bad of ["us", "ct", "mr", "nm"]) {
      expect(IMAGING_KEYWORDS).not.toContain(bad);
    }
    expect(LAB_KEYWORDS.every((k) => k.length >= 2)).toBe(true);
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

    it("keeps a row the clinician adds when the note did not name it", async () => {
      // The complaint this answers: the list is built from the note, so a row the note never mentions
      // simply was not there -- and the clinician had no way to say it. Adding it is their assertion;
      // the system's job is to keep it, not to have thought of it.
      renderScribe([]);
      fireEvent.change(screen.getByTestId("checklist-add-input"), {
        target: { value: "Check stool sample" },
      });
      fireEvent.click(screen.getByTestId("checklist-add-button"));
      expect(await screen.findByLabelText("Check stool sample")).toBeInTheDocument();
    });

    it("adds nothing for an empty box, and does not duplicate an existing row", async () => {
      renderScribe([]);
      fireEvent.click(screen.getByTestId("checklist-add-button"));
      expect(screen.queryAllByLabelText(/^\s*$/)).toHaveLength(0);

      for (const _ of [1, 2]) {
        fireEvent.change(screen.getByTestId("checklist-add-input"), { target: { value: "Review diet" } });
        fireEvent.click(screen.getByTestId("checklist-add-button"));
      }
      expect(await screen.findAllByLabelText("Review diet")).toHaveLength(1);
    });

  /**
   * Step 1 — Document. This stage has been "fixed" more than once and come back: the SOAP fields
   * stopped filling, an AI Team drawer covered the form, a cardiac checklist appeared for abdominal
   * complaints. Each was found by looking at the running app -- the slowest, most expensive way.
   * These are the assertions that would have caught them, and they run in a second, not after a demo.
   */
  // The SOAP-source rule that regressed is covered by soapSource.test.ts. Extracting it into a pure
  // function made the assertion possible without this provider and without timers -- the two things
  // that defeated three attempts to test it here. What failed was the harness, never the product.
  it("shows only rows true of any encounter when the note says nothing clinical yet", () => {
    // The regression: a cardiac workup (cardiovascular examination, ECG, lipid profile) was in the
    // template for every patient, so an abdominal complaint came with rows that could not apply.
    renderScribe([]);
    expect(screen.getByLabelText("Document onset and duration")).toBeInTheDocument();
    expect(screen.getByLabelText("Record vital signs")).toBeInTheDocument();
    expect(screen.queryByLabelText("Order ECG")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Review lipid profile")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Cardiovascular examination")).not.toBeInTheDocument();
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
    // onset/duration only, out of the two rows true of any encounter, and NOT vitals: the mocked API
    // returns no observations for this encounter, so that row stays open. This note used to tick a
    // third row -- cardiovascular examination -- which was in the template for every patient
    // regardless of complaint; it now arrives from the note only when the note raises it.
    await waitFor(() => {
      expect(screen.getByText(/^1\/2$/)).toBeInTheDocument();
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
