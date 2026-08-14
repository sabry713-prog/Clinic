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

  // -- S4.1 terminal cutaway: object-equality between graph output and UI ----
  // The core correctness claim: whatever object the graph returned is exactly
  // what the clinician sees. The fixture below is byte-identical to real
  // engine output — NECESSITY_LOOKUP_CYPHER copied verbatim from
  // services/veritas-graph/nphies_queries.py, steps copied verbatim from
  // validate_order_necessity's GREEN branch (and mirrored by the Python test
  // test_chain_carries_verdict_values_and_verbatim_cypher).

  const NECESSITY_LOOKUP_CYPHER = `
MATCH (d:NphiesDiagnosis {icd10: $icd10})-[r:NPHIES_JUSTIFIES]->(t)
WHERE (t:NphiesService AND (t.sbs_code = $code OR t.achi_code = $code))
   OR (t:NphiesDrug AND t.sfda_code = $code)
RETURN r.pre_auth_required AS pre_auth_required, labels(t)[0] AS target_type
LIMIT 1
`;

  const GRAPH_NECESSITY_CHAIN: EvidenceChain = {
    steps: [
      { node_type: "NphiesDiagnosis", properties: { icd10: "I10" } },
      { node_type: "NphiesService", properties: { code: "11700-00-10" } },
      { node_type: "NecessityRule", properties: { pre_auth_required: false, status: "GREEN" } },
    ],
    rendered: "NphiesDiagnosis(icd10=I10) -> NphiesService(code=11700-00-10) -> NecessityRule(pre_auth_required=False, status=GREEN)",
    cypher: [NECESSITY_LOOKUP_CYPHER],
  };

  it("displays the graph's chain object verbatim — every step, every fact, the exact Cypher", () => {
    render(
      <EvidenceChainPopover
        evidenceChain={GRAPH_NECESSITY_CHAIN}
        triggerLabel="Evidence"
        title="Necessity verdict: I10→11700-00-10"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
    const dialog = screen.getByRole("dialog", { name: "Evidence chain" });

    // Assertion title renders.
    expect(within(dialog).getByTestId("evidence-title")).toHaveTextContent(
      "Necessity verdict: I10→11700-00-10",
    );

    // Object-equality, steps: every node_type from the chain object appears.
    for (const step of GRAPH_NECESSITY_CHAIN.steps) {
      expect(within(dialog).getByText(step.node_type)).toBeInTheDocument();
    }

    // Object-equality, source facts: every property VALUE of every step is
    // displayed (String()-coerced exactly as the engine's render() does).
    const facts = within(dialog).getByTestId("evidence-source-facts");
    const displayedFacts = within(facts)
      .getAllByRole("row")
      .map((row) => within(row).getAllByRole("cell").map((c) => c.textContent ?? ""));
    const expectedFacts = GRAPH_NECESSITY_CHAIN.steps.flatMap((step) =>
      Object.entries(step.properties).map(
        ([k, v]) => [`${step.node_type}.${k}`, String(v)] as [string, string],
      ),
    );
    expect(displayedFacts).toEqual(expect.arrayContaining(expectedFacts));
    // And nothing extra: the facts table has exactly the chain's properties.
    expect(displayedFacts).toHaveLength(expectedFacts.length);

    // Object-equality, Cypher: the exact query string, byte-for-byte.
    const cypherBlock = within(dialog).getByTestId("evidence-cypher-0");
    expect(cypherBlock.textContent).toBe(NECESSITY_LOOKUP_CYPHER);

    // The rendered summary string matches the chain's own rendering.
    expect(within(dialog).getByText(GRAPH_NECESSITY_CHAIN.rendered)).toBeInTheDocument();
  });

  it("labels reference-map provenance as SQL, not Cypher", () => {
    render(
      <EvidenceChainPopover
        evidenceChain={{
          steps: [{ node_type: "ReferenceMap", properties: { table: "app.snomed_icd10am_map" } }],
          rendered: "ReferenceMap(table=app.snomed_icd10am_map)",
          cypher: ["SELECT m.icd10am_code FROM app.snomed_icd10am_map m WHERE m.snomed_code = $1"],
        }}
        triggerLabel="Provenance"
        queryLabel="SQL executed"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Provenance" }));
    const dialog = screen.getByRole("dialog", { name: "Evidence chain" });
    expect(within(dialog).getByText("SQL executed")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/SELECT m\.icd10am_code FROM app\.snomed_icd10am_map/),
    ).toBeInTheDocument();
  });

  it("omits the query section when the chain carries no query text", () => {
    render(<EvidenceChainPopover evidenceChain={CHAIN} />);
    fireEvent.click(screen.getByRole("button", { name: "Show Reasoning" }));
    expect(screen.queryByTestId("evidence-cypher-section")).not.toBeInTheDocument();
    // Source facts are still shown.
    expect(screen.getByTestId("evidence-source-facts")).toBeInTheDocument();
  });
});
