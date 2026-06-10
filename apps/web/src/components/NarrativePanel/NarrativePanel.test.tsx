/**
 * NarrativePanel unit tests.
 *
 * AC-4 exit gate checks:
 * - Renders "Generate Narrative" button
 * - Calls narrative API on button click
 * - Shows loading state
 * - Renders narrative text on success
 * - Shows fallback message when text is null
 * - No forbidden words in rendered output
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NarrativePanel from "./NarrativePanel";
import { api } from "../../lib/api";
import type { NarrativeItem } from "../../lib/api";

// Mock i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));

// Mock the api module
vi.mock("../../lib/api", () => ({
  api: {
    narrative: {
      generate: vi.fn(),
      get: vi.fn(),
      sources: vi.fn(),
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

const mockGenerate = vi.mocked(api.narrative.generate);

const FACTUAL_NARRATIVE: NarrativeItem = {
  id: "narrative-001",
  patient_id: "patient-001",
  generated_at: "2026-05-25T08:04:00Z",
  language: "en",
  scope: "full",
  text: "The patient was admitted on 22 May 2026. Documented active problems include type 2 diabetes.",
  fallback_message: null,
  provenance: [
    {
      sentence_index: 0,
      char_range: [0, 45],
      sources: [{ type: "Encounter", id: "enc-001", field: "admission" }],
    },
  ],
  model_version: "stub-v1",
  prompt_template_version: "v1.0",
  disclaimer:
    "Auto-generated descriptive summary. Not a clinical interpretation. For clinician review only.",
};

const FALLBACK_NARRATIVE: NarrativeItem = {
  id: "narrative-002",
  patient_id: "patient-001",
  generated_at: "2026-05-25T08:04:00Z",
  language: "en",
  scope: "full",
  text: null,
  fallback_message: "Narrative summary unavailable. Please review the record directly.",
  provenance: [],
  model_version: "stub-v1",
  prompt_template_version: "v1.0",
  disclaimer:
    "Auto-generated descriptive summary. Not a clinical interpretation. For clinician review only.",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NarrativePanel", () => {
  it("renders Generate Narrative button", () => {
    render(<NarrativePanel patientId="patient-001" />);
    expect(screen.getByTestId("generate-narrative-btn")).toBeInTheDocument();
  });

  it("has language selector", () => {
    render(<NarrativePanel patientId="patient-001" />);
    expect(screen.getByTestId("language-select")).toBeInTheDocument();
  });

  it("has scope selector with all options", () => {
    render(<NarrativePanel patientId="patient-001" />);
    const select = screen.getByTestId("scope-select");
    expect(select).toBeInTheDocument();
    expect(screen.getByText("Full record")).toBeInTheDocument();
    expect(screen.getByText("Current encounter")).toBeInTheDocument();
    expect(screen.getByText("Last 30 days")).toBeInTheDocument();
  });

  it("calls narrative API on button click", async () => {
    mockGenerate.mockResolvedValueOnce(FACTUAL_NARRATIVE);
    render(<NarrativePanel patientId="patient-001" />);
    await userEvent.click(screen.getByTestId("generate-narrative-btn"));
    expect(mockGenerate).toHaveBeenCalledWith("patient-001", {
      language: "en",
      scope: "full",
      regenerate: false,
    });
  });

  it("shows loading state during generation", async () => {
    let resolve!: (v: NarrativeItem) => void;
    mockGenerate.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    render(<NarrativePanel patientId="patient-001" />);
    await userEvent.click(screen.getByTestId("generate-narrative-btn"));
    expect(screen.getByTestId("loading-state")).toBeInTheDocument();
    resolve(FACTUAL_NARRATIVE);
  });

  it("renders narrative text on success", async () => {
    mockGenerate.mockResolvedValueOnce(FACTUAL_NARRATIVE);
    render(<NarrativePanel patientId="patient-001" />);
    await userEvent.click(screen.getByTestId("generate-narrative-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("narrative-text")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("narrative-text").textContent).toContain(
      "admitted on 22 May 2026",
    );
  });

  it("shows disclaimer after generation", async () => {
    mockGenerate.mockResolvedValueOnce(FACTUAL_NARRATIVE);
    render(<NarrativePanel patientId="patient-001" />);
    await userEvent.click(screen.getByTestId("generate-narrative-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("disclaimer")).toBeInTheDocument(),
    );
    const disclaimer = screen.getByTestId("disclaimer").textContent ?? "";
    expect(disclaimer).toContain("Not a clinical interpretation");
  });

  it("shows fallback message when text is null", async () => {
    mockGenerate.mockResolvedValueOnce(FALLBACK_NARRATIVE);
    render(<NarrativePanel patientId="patient-001" />);
    await userEvent.click(screen.getByTestId("generate-narrative-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("fallback-message")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("fallback-message").textContent).toContain(
      "Narrative summary unavailable",
    );
  });

  it("does not render narrative-text when fallback", async () => {
    mockGenerate.mockResolvedValueOnce(FALLBACK_NARRATIVE);
    render(<NarrativePanel patientId="patient-001" />);
    await userEvent.click(screen.getByTestId("generate-narrative-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("fallback-message")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("narrative-text")).not.toBeInTheDocument();
  });

  it("no forbidden words in rendered narrative text", async () => {
    mockGenerate.mockResolvedValueOnce(FACTUAL_NARRATIVE);
    render(<NarrativePanel patientId="patient-001" />);
    await userEvent.click(screen.getByTestId("generate-narrative-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("narrative-text")).toBeInTheDocument(),
    );
    const text = (screen.getByTestId("narrative-text").textContent ?? "").toLowerCase();
    const forbidden = [
      "worsening",
      "concerning",
      "elevated",
      "suggest",
      "indicates",
      "recommend",
      "monitor for",
      "at risk",
      "prognosis",
      "rule out",
      "differential",
    ];
    for (const word of forbidden) {
      expect(text).not.toContain(word);
    }
  });

  it("does not trigger generation without explicit user action", () => {
    render(<NarrativePanel patientId="patient-001" />);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("narrative-text")).not.toBeInTheDocument();
  });

  it("button is disabled during loading", async () => {
    let resolve!: (v: NarrativeItem) => void;
    mockGenerate.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    render(<NarrativePanel patientId="patient-001" />);
    await userEvent.click(screen.getByTestId("generate-narrative-btn"));
    expect(screen.getByTestId("generate-narrative-btn")).toBeDisabled();
    resolve(FACTUAL_NARRATIVE);
  });
});
