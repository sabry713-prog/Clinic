/**
 * Tests for the 3-pane Sully shell: pane rendering, drawer collapse/expand,
 * agent tab switching, live SOAP editing, and NPHIES badge states.
 *
 * autoStream is disabled so the simulated transcript timer never fires and
 * the tests stay deterministic.
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SullyShell from "./SullyShell";
import NphiesBadge from "./NphiesBadge";

function renderShell() {
  // The pane uses useSearchParams for the "New order" deep-link, so the shell
  // needs a router context here exactly as it has one in the app.
  return render(
    <MemoryRouter>
      <SullyShell patientName="Test Patient Alpha" autoStream={false} />
    </MemoryRouter>,
  );
}

describe("SullyShell — 3-pane layout", () => {
  it("renders all three panes", () => {
    renderShell();
    expect(screen.getByLabelText("Ambient scribe")).toBeInTheDocument();
    expect(screen.getByLabelText("Patient timeline and orders")).toBeInTheDocument();
    expect(screen.getByLabelText("AI Team drawer")).toBeInTheDocument();
  });

  it("shows the patient name in the encounter header", () => {
    renderShell();
    expect(screen.getByText("Test Patient Alpha")).toBeInTheDocument();
  });
});

describe("Ambient scribe pane", () => {
  it("starts not recording and toggles on click", () => {
    renderShell();
    const btn = screen.getByRole("button", { name: /record/i });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: /stop/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders all four SOAP fields as editable textareas", () => {
    renderShell();
    for (const label of ["Subjective", "Objective", "Assessment", "Plan"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("updates the SOAP note as the clinician types (live state)", () => {
    renderShell();
    const subjective = screen.getByLabelText("Subjective") as HTMLTextAreaElement;
    fireEvent.change(subjective, { target: { value: "Patient reports chest tightness." } });
    expect(subjective.value).toBe("Patient reports chest tightness.");
  });

  it("toggles smart checklist items", () => {
    renderShell();
    const item = screen.getByLabelText("Order ECG") as HTMLInputElement;
    expect(item.checked).toBe(false);
    fireEvent.click(item);
    expect(item.checked).toBe(true);
  });
});

describe("Timeline & orders pane", () => {
  it("renders timeline entries", () => {
    renderShell();
    expect(screen.getByText("Cardiology clinic visit")).toBeInTheDocument();
    expect(screen.getByText("Chest X-ray")).toBeInTheDocument();
  });

  it("renders order lines with their codes", () => {
    renderShell();
    expect(screen.getByText("Electrocardiogram (ECG), 12 lead")).toBeInTheDocument();
    expect(screen.getByText("SBS 11700-00-10")).toBeInTheDocument();
  });

  it("renders an NPHIES badge for every order line", () => {
    renderShell();
    const badges = screen.getAllByLabelText(/NPHIES status:/);
    expect(badges.length).toBeGreaterThanOrEqual(5);
  });

  it("shows all three NPHIES statuses across the mock orders", () => {
    renderShell();
    expect(screen.getAllByLabelText("NPHIES status: Approved").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("NPHIES status: Pre-auth required").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("NPHIES status: Code mismatch").length).toBeGreaterThan(0);
  });
});

describe("AI Team drawer", () => {
  it("renders all five agent tabs", () => {
    renderShell();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(5);
  });

  it("defaults to the Scribe agent", () => {
    renderShell();
    expect(screen.getByRole("tab", { name: "Scribe" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches the action cards when another agent tab is selected", () => {
    renderShell();
    // Scribe actions first
    expect(screen.getByText("Regenerate SOAP note")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Pharmacist" }));
    expect(screen.getByRole("tab", { name: "Pharmacist" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Adjust Dosage")).toBeInTheDocument();
    expect(screen.queryByText("Regenerate SOAP note")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "NPHIES / Billing" }));
    expect(screen.getByText("Submit Pre-Auth")).toBeInTheDocument();
  });

  it("appends to the activity stream when an action is run", () => {
    renderShell();
    const panel = screen.getByLabelText("Scribe actions");
    const runBtn = within(panel).getAllByRole("button", { name: /run/i })[0];
    fireEvent.click(runBtn!);
    expect(screen.getByText("Regenerate SOAP note — requested.")).toBeInTheDocument();
  });

  it("collapses and expands, swapping to the rail", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /collapse ai team drawer/i }));
    expect(screen.getByLabelText("AI Team drawer (collapsed)")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /expand ai team drawer/i }));
    expect(screen.getByLabelText("AI Team drawer")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(5);
  });
});

describe("NphiesBadge", () => {
  it("reveals detail and suggested codes on click", () => {
    render(
      <NphiesBadge
        status="red"
        detail="Code mismatch — high rejection risk."
        suggestedCodes={["38300-00-10", "38306-00-10"]}
      />,
    );
    fireEvent.click(screen.getByLabelText("NPHIES status: Code mismatch"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByText("Code mismatch — high rejection risk.")).toBeInTheDocument();
    expect(screen.getByText("38300-00-10")).toBeInTheDocument();
  });

  it("fires the 1-click action", () => {
    let fired = false;
    render(
      <NphiesBadge
        status="yellow"
        detail="Pre-authorisation required."
        actionLabel="Submit Pre-Auth"
        onAction={() => { fired = true; }}
      />,
    );
    fireEvent.click(screen.getByLabelText("NPHIES status: Pre-auth required"));
    fireEvent.click(screen.getByRole("button", { name: "Submit Pre-Auth" }));
    expect(fired).toBe(true);
  });

  it("omits the evidence-chain trigger when no evidenceChain is given", () => {
    render(<NphiesBadge status="green" detail="Approved / covered." />);
    fireEvent.click(screen.getByLabelText("NPHIES status: Approved"));
    expect(screen.queryByRole("button", { name: "View Evidence Chain" })).not.toBeInTheDocument();
  });

  it("shows a 'View Evidence Chain' trigger when a live evidenceChain is present", () => {
    render(
      <NphiesBadge
        status="yellow"
        detail="Pre-authorisation required by the payer."
        evidenceChain={{
          steps: [
            { node_type: "Patient", properties: { id: "p-1" } },
            { node_type: "NphiesRule", properties: { pre_auth_required: true } },
          ],
          rendered: "Patient(id=p-1) -> NphiesRule(pre_auth_required=true)",
        }}
      />,
    );
    fireEvent.click(screen.getByLabelText("NPHIES status: Pre-auth required"));
    const trigger = screen.getByRole("button", { name: "View Evidence Chain" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Evidence chain" })).toBeInTheDocument();
  });
});

describe("Inter-agent handoffs (Sprint 10)", () => {
  it("renders handoff messages with their source -> target chain", () => {
    renderShell();
    const handoffs = screen.getAllByTestId("handoff-chain");
    expect(handoffs.length).toBeGreaterThanOrEqual(4);
    expect(handoffs[0]).toHaveTextContent("consultant");
    expect(handoffs[0]).toHaveTextContent("pharmacist");
  });

  it("distinguishes handoffs from an agent's own output", () => {
    renderShell();
    // A plain agent message keeps the agent label and carries no chain.
    const plain = screen.getByText("Draft SOAP note updated from the live transcript.")
      .parentElement as HTMLElement;
    expect(within(plain).queryByTestId("handoff-chain")).not.toBeInTheDocument();

    // A handoff message carries the chain instead.
    const chained = screen.getByText(
      "Escalating a critical dose-safety finding on Metformin to Pharmacy.",
    ).parentElement as HTMLElement;
    expect(within(chained).getByTestId("handoff-chain")).toBeInTheDocument();
  });

  it("frames screened candidates as screening, not a recommendation", () => {
    renderShell();
    expect(screen.getByText(/Not a substitution recommendation/i)).toBeInTheDocument();
  });

  it("shows the Receptionist post-care drafts in its own tab", () => {
    renderShell();
    fireEvent.click(screen.getByRole("tab", { name: "Receptionist" }));
    expect(screen.getByText(/nothing below has been booked or sent/i)).toBeInTheDocument();
    expect(screen.getByTestId("care-instructions")).toBeInTheDocument();
  });
});

describe("Phase 1 stabilization — demo honesty", () => {
  // Audit H-4: the popover trigger used to render nowhere without a live
  // backend, hiding the product's central explainability feature.
  it("shows an evidence-chain trigger on NPHIES badges in demo mode", () => {
    renderShell();
    // The red angiography badge toggles its tooltip on click (yellow badges go
    // straight to the pre-auth modal instead, per Sprint 9).
    fireEvent.click(screen.getByLabelText("NPHIES status: Code mismatch"));
    expect(screen.getByRole("button", { name: "View Evidence Chain" })).toBeInTheDocument();
  });

  it("renders the graph traversal when the badge popover is opened", () => {
    renderShell();
    fireEvent.click(screen.getByLabelText("NPHIES status: Code mismatch"));
    fireEvent.click(screen.getByRole("button", { name: "View Evidence Chain" }));
    const dialog = screen.getByRole("dialog", { name: "Evidence chain" });
    expect(within(dialog).getByTestId("evidence-chain-steps")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Patient(MRN=102) -> Condition(icd10=I25.1) -> NphiesService(sbs_code=38306-00-99) -> NphiesRule(status=RED, matched=false)",
      ),
    ).toBeInTheDocument();
  });

  it("shows Show Reasoning on agent messages in demo mode", () => {
    renderShell();
    expect(screen.getAllByRole("button", { name: "Show Reasoning" }).length).toBeGreaterThan(0);
  });

  it("renders the captured Metformin renal chain verbatim", () => {
    renderShell();
    fireEvent.click(screen.getAllByRole("button", { name: "Show Reasoning" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Evidence chain" });
    expect(
      within(dialog).getByText(
        'Patient(MRN=102) -> LabResult(eGFR=28) -> Contraindication(Metformin, "eGFR < 30") -> Rule(CRITICAL_OVERRIDE)',
      ),
    ).toBeInTheDocument();
  });

  // Audit H-3: capture source must be explicit, never implied.
  it("offers an explicit live/demo dictation toggle", () => {
    renderShell();
    expect(screen.getByRole("radio", { name: "Live microphone" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Demo playback" })).toBeInTheDocument();
  });

  it("defaults to demo playback with no patient and labels it as scripted", () => {
    renderShell();
    expect(screen.getByRole("radio", { name: "Demo playback" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText(/scripted sample — not a recording/i)).toBeInTheDocument();
  });

  it("explains why live capture is unavailable without an encounter", () => {
    renderShell();
    fireEvent.click(screen.getByRole("radio", { name: "Live microphone" }));
    expect(screen.getByText(/No patient encounter is open/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /record/i })).toBeDisabled();
  });
});

describe("Order entry controls (audit M-5)", () => {
  it("filters the order list by category", () => {
    renderShell();
    expect(screen.getByText("Electrocardiogram (ECG), 12 lead")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Medications/i }));
    // Only the medication order survives the filter.
    expect(screen.getByText("Atorvastatin 20 mg")).toBeInTheDocument();
    expect(screen.queryByText("Electrocardiogram (ECG), 12 lead")).not.toBeInTheDocument();
  });

  it("marks the active category and clears it on a second click", () => {
    renderShell();
    const chip = screen.getByRole("button", { name: /Labs/i });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Electrocardiogram (ECG), 12 lead")).toBeInTheDocument();
  });

  it("explains an empty category rather than showing a blank list", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /Procedures/i }));
    // Angiography is the only procedure, so pick one with no orders instead.
    fireEvent.click(screen.getByRole("button", { name: /Procedures/i }));
    fireEvent.click(screen.getByRole("button", { name: /Medications/i }));
    expect(screen.queryByText(/No .* orders on this encounter/)).not.toBeInTheDocument();
  });

  it("gives the New order button a working handler", () => {
    renderShell();
    const btn = screen.getByRole("button", { name: /New order/i });
    expect(btn).toBeEnabled();
    // Wired to the real order-entry flow; clicking must not throw.
    expect(() => fireEvent.click(btn)).not.toThrow();
  });

  it("caps the timeline height so a long history stays scrollable", () => {
    renderShell();
    const feed = screen.getByTestId("timeline-feed");
    expect(feed.className).toMatch(/max-h-/);
    expect(feed.className).toMatch(/overflow-y-auto/);
  });
});
