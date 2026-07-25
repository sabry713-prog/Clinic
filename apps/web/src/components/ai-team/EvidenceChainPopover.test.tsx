import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import EvidenceChainPopover from "./EvidenceChainPopover";
import type { EvidenceChain } from "../../hooks/useAgentOrchestrator";

const CHAIN: EvidenceChain = {
  steps: [
    { node_type: "Patient", properties: { id: "p-1" } },
    { node_type: "LabResult", properties: { eGFR: 28 } },
    { node_type: "Medication", properties: { name: "Metformin" } },
    { node_type: "Rule", properties: { flag: "CRITICAL_OVERRIDE" } },
  ],
  rendered:
    "Patient(id=p-1) -> LabResult(eGFR=28) -> Medication(name=Metformin) -> Rule(flag=CRITICAL_OVERRIDE)",
};

describe("EvidenceChainPopover", () => {
  it("is closed by default", () => {
    render(<EvidenceChainPopover evidenceChain={CHAIN} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses the default 'Show Reasoning' trigger label", () => {
    render(<EvidenceChainPopover evidenceChain={CHAIN} />);
    expect(screen.getByRole("button", { name: "Show Reasoning" })).toBeInTheDocument();
  });

  it("accepts a custom trigger label", () => {
    render(<EvidenceChainPopover evidenceChain={CHAIN} triggerLabel="View Evidence Chain" />);
    expect(screen.getByRole("button", { name: "View Evidence Chain" })).toBeInTheDocument();
  });

  it("renders every step and the rendered fallback string on open", () => {
    render(<EvidenceChainPopover evidenceChain={CHAIN} />);
    fireEvent.click(screen.getByRole("button", { name: "Show Reasoning" }));

    const dialog = screen.getByRole("dialog", { name: "Evidence chain" });
    const steps = within(dialog).getByTestId("evidence-chain-steps");
    expect(within(steps).getByText("Patient")).toBeInTheDocument();
    expect(within(steps).getByText("LabResult")).toBeInTheDocument();
    expect(within(steps).getByText("Medication")).toBeInTheDocument();
    expect(within(steps).getByText("Rule")).toBeInTheDocument();
    expect(within(dialog).getByText(CHAIN.rendered)).toBeInTheDocument();
  });

  it("toggles closed again on a second click", () => {
    render(<EvidenceChainPopover evidenceChain={CHAIN} />);
    const trigger = screen.getByRole("button", { name: "Show Reasoning" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
