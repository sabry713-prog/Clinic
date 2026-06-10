import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import QAConversation from "./QAConversation";
import { api } from "../../lib/api";
import type { QAResponse } from "../../lib/api";

vi.mock("../../lib/api");
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn() },
  }),
}));

const mockAllowedResponse: QAResponse = {
  interaction_id: "ia-001",
  patient_id: "p-001",
  conversation_id: "conv-001",
  question: "What was the last creatinine?",
  classification: "ALLOWED",
  classifier_confidence: 0.97,
  refusal_category: null,
  rule_matches: [],
  language: "en",
  answer_text: "The last documented creatinine was 168 μmol/L on 24 May 2026.",
  sources: [
    {
      fact_segment: "168 μmol/L on 24 May 2026",
      type: "Observation",
      id: "obs-001",
      code: "LOINC:2160-0",
      source_system: "LIS",
      field: "",
    },
  ],
  model_version: "stub-v1",
  prompt_template_version: "v1.0",
  latency_ms: 120,
  disclaimer: "Factual lookup only.",
  blocklist_triggered: false,
};

const mockRefusedResponse: QAResponse = {
  ...mockAllowedResponse,
  interaction_id: "ia-002",
  question: "Is kidney function getting worse?",
  classification: "REFUSED",
  classifier_confidence: 0.99,
  refusal_category: "TREND_INTERPRETATION",
  rule_matches: ["TREND_INTERPRETATION:is_X_getting_worse"],
  answer_text: "I don't interpret clinical trends. Here are the documented creatinine values:",
  sources: [],
  latency_ms: 45,
};

describe("QAConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders input and send button", () => {
    render(
      <QAConversation
        patientId="p-001"
        language="en"
        onLanguageToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox", { name: "qa.input_label" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "qa.send" })).toBeInTheDocument();
  });

  it("shows disclaimer at the top", () => {
    render(
      <QAConversation patientId="p-001" language="en" onLanguageToggle={vi.fn()} />,
    );
    expect(screen.getByText("qa.disclaimer")).toBeInTheDocument();
  });

  it("shows empty state when no turns", () => {
    render(
      <QAConversation patientId="p-001" language="en" onLanguageToggle={vi.fn()} />,
    );
    expect(screen.getByText("qa.empty_state")).toBeInTheDocument();
  });

  it("calls api.qa.ask on submit and shows allowed answer", async () => {
    vi.mocked(api.qa.ask).mockResolvedValueOnce(mockAllowedResponse);

    render(
      <QAConversation patientId="p-001" language="en" onLanguageToggle={vi.fn()} />,
    );

    const input = screen.getByRole("textbox", { name: "qa.input_label" });
    fireEvent.change(input, { target: { value: "What was the last creatinine?" } });
    fireEvent.click(screen.getByRole("button", { name: "qa.send" }));

    await waitFor(() => {
      expect(api.qa.ask).toHaveBeenCalledWith("p-001", {
        question: "What was the last creatinine?",
        language: "en",
        conversation_id: null,
      });
    });

    expect(
      screen.getByText("The last documented creatinine was 168 μmol/L on 24 May 2026."),
    ).toBeInTheDocument();
  });

  it("shows loading state while waiting", async () => {
    let resolve!: (v: QAResponse) => void;
    vi.mocked(api.qa.ask).mockReturnValueOnce(
      new Promise<QAResponse>((r) => { resolve = r; }),
    );

    render(
      <QAConversation patientId="p-001" language="en" onLanguageToggle={vi.fn()} />,
    );

    const input = screen.getByRole("textbox", { name: "qa.input_label" });
    fireEvent.change(input, { target: { value: "What are the vitals?" } });
    fireEvent.click(screen.getByRole("button", { name: "qa.send" }));

    expect(screen.getByRole("status")).toBeInTheDocument();
    resolve(mockAllowedResponse);
  });

  it("renders refused response in neutral italic style — no alert/warning/critical class", async () => {
    vi.mocked(api.qa.ask).mockResolvedValueOnce(mockRefusedResponse);

    render(
      <QAConversation patientId="p-001" language="en" onLanguageToggle={vi.fn()} />,
    );

    const input = screen.getByRole("textbox", { name: "qa.input_label" });
    fireEvent.change(input, { target: { value: "Is kidney function getting worse?" } });
    fireEvent.click(screen.getByRole("button", { name: "qa.send" }));

    await waitFor(() => {
      expect(
        screen.getByText(/I don't interpret clinical trends/),
      ).toBeInTheDocument();
    });

    // Response container must not have alert / warning / critical / danger classes
    const responseBubble = screen
      .getByText(/I don't interpret clinical trends/)
      .closest("div");
    expect(responseBubble?.className).not.toMatch(/alert|warning|critical|danger|red/);
  });

  it("shows source list toggle for ALLOWED responses", async () => {
    vi.mocked(api.qa.ask).mockResolvedValueOnce(mockAllowedResponse);

    render(
      <QAConversation patientId="p-001" language="en" onLanguageToggle={vi.fn()} />,
    );

    const input = screen.getByRole("textbox", { name: "qa.input_label" });
    fireEvent.change(input, { target: { value: "What was the last creatinine?" } });
    fireEvent.click(screen.getByRole("button", { name: "qa.send" }));

    await waitFor(() => {
      expect(screen.getByText(/qa\.show_sources/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/qa\.show_sources/));
    expect(screen.getByText("168 μmol/L on 24 May 2026")).toBeInTheDocument();
    expect(screen.getByText(/Observation/)).toBeInTheDocument();
  });

  it("renders language toggle button", () => {
    const toggle = vi.fn();
    render(
      <QAConversation patientId="p-001" language="en" onLanguageToggle={toggle} />,
    );
    const btn = screen.getByRole("button", { name: "qa.toggle_language" });
    fireEvent.click(btn);
    expect(toggle).toHaveBeenCalledOnce();
  });

  it("renders in RTL when language is ar", () => {
    render(
      <QAConversation patientId="p-001" language="ar" onLanguageToggle={vi.fn()} />,
    );
    const container = screen.getByRole("textbox", { name: "qa.input_label" }).closest('[dir]');
    expect(container?.getAttribute("dir")).toBe("rtl");
  });

  it("shows error message on network failure", async () => {
    vi.mocked(api.qa.ask).mockRejectedValueOnce(new Error("Network error"));

    render(
      <QAConversation patientId="p-001" language="en" onLanguageToggle={vi.fn()} />,
    );

    const input = screen.getByRole("textbox", { name: "qa.input_label" });
    fireEvent.change(input, { target: { value: "Any question" } });
    fireEvent.click(screen.getByRole("button", { name: "qa.send" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });
});
