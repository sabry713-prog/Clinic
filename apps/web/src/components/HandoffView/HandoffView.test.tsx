import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import HandoffView from "./HandoffView";
import type { HandoffOutput } from "../../lib/api";

// Mock i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "common.loading": "Loading...",
        "handoff.title": "Shift Handoff",
        "handoff.generated_at": "Generated at",
        "handoff.scope": "Scope",
        "handoff.language": "Language",
        "handoff.copy": "Copy",
        "handoff.print": "Print",
        "handoff.section.identity": "Identity and Admission",
        "handoff.section.documented_today": "Documented Today",
        "handoff.section.medications": "Current Medications",
        "handoff.section.vitals": "Recent Vitals",
        "handoff.section.labs": "Recent Labs",
        "handoff.section.orders": "Pending Orders",
      };
      return map[key] ?? key;
    },
    i18n: { changeLanguage: vi.fn() },
  }),
}));

const mockHandoff: HandoffOutput = {
  id: "handoff-1",
  patient_id: "patient-1",
  ward_id: "WARD-A",
  generated_at: "2026-06-10T10:00:00Z",
  language: "en",
  scope: "current_shift",
  text: "### Identity and Admission\n- Name: Ahmed Al-Rashid\n",
  sections: {
    identity_and_admission: ["Name: Ahmed Al-Rashid", "MRN: 001"],
    documented_today: [],
    current_medications: ["Metformin 500mg — oral — twice daily"],
    recent_vitals: ["Heart rate: 72 bpm [60–100 bpm] (2026-06-10)"],
    recent_labs: ["Creatinine: 90 μmol/L [59–104 μmol/L] (2026-06-10)"],
    pending_orders: [],
  },
  provenance: [],
  disclaimer:
    "Reproduces documented information from the patient record. For clinician reference only. Not a clinical assessment.",
};

describe("HandoffView", () => {
  it("renders loading state", () => {
    render(
      <HandoffView
        handoff={mockHandoff}
        isLoading={true}
      />,
    );
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders all section panels", () => {
    render(<HandoffView handoff={mockHandoff} />);

    expect(screen.getByText("Identity and Admission")).toBeInTheDocument();
    expect(screen.getByText("Documented Today")).toBeInTheDocument();
    expect(screen.getByText("Current Medications")).toBeInTheDocument();
    expect(screen.getByText("Recent Vitals")).toBeInTheDocument();
    expect(screen.getByText("Recent Labs")).toBeInTheDocument();
    expect(screen.getByText("Pending Orders")).toBeInTheDocument();
  });

  it("renders patient name in identity section", () => {
    render(<HandoffView handoff={mockHandoff} />);
    expect(screen.getByText("Name: Ahmed Al-Rashid")).toBeInTheDocument();
  });

  it("renders disclaimer", () => {
    render(<HandoffView handoff={mockHandoff} />);
    expect(
      screen.getByText(/Reproduces documented information from the patient record/),
    ).toBeInTheDocument();
  });

  it("shows (None documented) for empty sections", () => {
    render(<HandoffView handoff={mockHandoff} />);
    // documented_today and pending_orders are empty
    const noneTexts = screen.getAllByText("None documented");
    expect(noneTexts.length).toBeGreaterThanOrEqual(2);
  });

  it("renders copy and print buttons", () => {
    render(<HandoffView handoff={mockHandoff} />);
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
  });
});
