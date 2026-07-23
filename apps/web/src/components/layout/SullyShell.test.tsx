/**
 * Tests for the 3-pane Sully shell: pane rendering, drawer collapse/expand,
 * agent tab switching, live SOAP editing, and NPHIES badge states.
 *
 * autoStream is disabled so the simulated transcript timer never fires and
 * the tests stay deterministic.
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import SullyShell from "./SullyShell";
import NphiesBadge from "./NphiesBadge";

function renderShell() {
  return render(<SullyShell patientName="Test Patient Alpha" autoStream={false} />);
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
  // Sprint 4 replaced the mock pane with the live scribe (real capture +
  // orchestrator). Recording is now async and requires audio permission, so
  // the toggle is exercised in LiveScribePane.test.tsx with those mocked.
  // Here we only assert the shell composes the pane and its controls.
  it("renders the recording control, not yet recording", () => {
    renderShell();
    const btn = screen.getByRole("button", { name: /record/i });
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("offers sample replay so the pane works without a microphone", () => {
    renderShell();
    expect(screen.getByRole("button", { name: /replay sample/i })).toBeInTheDocument();
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

  // The checklist is now driven by symptoms actually spoken in the
  // transcript, so it starts empty rather than pre-populated.
  it("starts with an empty smart checklist", () => {
    renderShell();
    expect(screen.getByText(/appear here when a symptom is mentioned/i)).toBeInTheDocument();
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
});
