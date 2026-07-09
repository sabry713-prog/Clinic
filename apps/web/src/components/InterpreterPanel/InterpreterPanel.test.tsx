/**
 * InterpreterPanel unit tests.
 *
 * - Renders language selectors + translate button
 * - Calls interpreter API on translate click with typed message
 * - Swap button swaps source/target languages
 * - Renders translated text on success
 * - Shows fallback message when text is null
 * - No forbidden words in rendered translation output
 * - Does not translate without explicit user action
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InterpreterPanel from "./InterpreterPanel";
import { api } from "../../lib/api";
import type { TranslatedMessage } from "../../lib/api";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));

vi.mock("../../lib/api", () => ({
  api: {
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

const mockTranslate = vi.mocked(api.interpreter.translate);

const TRANSLATED: TranslatedMessage = {
  text: "من فضلك خذ Panadol مرتين يومياً.",
  fallback_message: null,
  prompt_template_version: "v1.0",
  blocklist_triggered: false,
  disclaimer:
    "Machine translation for bedside communication. Not a clinical interpretation. For urgent or complex conversations, use a qualified human interpreter.",
};

const FALLBACK: TranslatedMessage = {
  text: null,
  fallback_message: "Translation unavailable. Please rephrase or use an in-person interpreter.",
  prompt_template_version: "v1.0",
  blocklist_triggered: true,
  disclaimer:
    "Machine translation for bedside communication. Not a clinical interpretation. For urgent or complex conversations, use a qualified human interpreter.",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InterpreterPanel", () => {
  it("renders language selectors and translate button", () => {
    render(<InterpreterPanel patientId="patient-001" />);
    expect(screen.getByTestId("source-language-select")).toBeInTheDocument();
    expect(screen.getByTestId("target-language-select")).toBeInTheDocument();
    expect(screen.getByTestId("translate-btn")).toBeInTheDocument();
  });

  it("translate button is disabled with empty message", () => {
    render(<InterpreterPanel patientId="patient-001" />);
    expect(screen.getByTestId("translate-btn")).toBeDisabled();
  });

  it("calls interpreter API on translate click", async () => {
    mockTranslate.mockResolvedValueOnce(TRANSLATED);
    render(<InterpreterPanel patientId="patient-001" />);
    await userEvent.type(screen.getByTestId("interpreter-message-input"), "Please take Panadol twice daily.");
    await userEvent.click(screen.getByTestId("translate-btn"));
    expect(mockTranslate).toHaveBeenCalledWith("patient-001", {
      text: "Please take Panadol twice daily.",
      sourceLanguage: "en",
      targetLanguage: "ar",
    });
  });

  it("swap button swaps source and target languages", async () => {
    render(<InterpreterPanel patientId="patient-001" />);
    const source = screen.getByTestId("source-language-select") as HTMLSelectElement;
    const target = screen.getByTestId("target-language-select") as HTMLSelectElement;
    expect(source.value).toBe("en");
    expect(target.value).toBe("ar");
    await userEvent.click(screen.getByTestId("swap-languages-btn"));
    expect(source.value).toBe("ar");
    expect(target.value).toBe("en");
  });

  it("renders translated text on success", async () => {
    mockTranslate.mockResolvedValueOnce(TRANSLATED);
    render(<InterpreterPanel patientId="patient-001" />);
    await userEvent.type(screen.getByTestId("interpreter-message-input"), "Please take Panadol twice daily.");
    await userEvent.click(screen.getByTestId("translate-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("translation-result")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("translation-result").textContent).toContain("Panadol");
  });

  it("shows fallback message when translation is null", async () => {
    mockTranslate.mockResolvedValueOnce(FALLBACK);
    render(<InterpreterPanel patientId="patient-001" />);
    await userEvent.type(screen.getByTestId("interpreter-message-input"), "Test message");
    await userEvent.click(screen.getByTestId("translate-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("translation-result")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("translation-result").textContent).toContain(
      "Translation unavailable",
    );
  });

  it("no forbidden words in rendered translation output", async () => {
    mockTranslate.mockResolvedValueOnce(TRANSLATED);
    render(<InterpreterPanel patientId="patient-001" />);
    await userEvent.type(screen.getByTestId("interpreter-message-input"), "Please take Panadol twice daily.");
    await userEvent.click(screen.getByTestId("translate-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("translation-result")).toBeInTheDocument(),
    );
    const text = (screen.getByTestId("translation-result").textContent ?? "").toLowerCase();
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

  it("does not translate without explicit user action", () => {
    render(<InterpreterPanel patientId="patient-001" />);
    expect(mockTranslate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("translation-result")).not.toBeInTheDocument();
  });
});
