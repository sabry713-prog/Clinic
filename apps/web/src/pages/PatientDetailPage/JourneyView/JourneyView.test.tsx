/**
 * JourneyView tests — the governance-critical wizard behaviors:
 * - stage rail renders and navigates freely
 * - order candidates arrive PRE-SELECTED; veto removes them from the batch
 * - one "Create selected orders" calls the batch endpoint once
 * - SBS suggestions arrive pre-selected; approve confirms each selected
 * - submit is disabled until the draft is ready
 * - stage persistence survives remount (resume)
 * - diagnosis linkage chips are NEVER pre-selected (clinician taps each)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import JourneyView from "./JourneyView";
import { api } from "../../../lib/api";
import type { PatientDetail } from "../../../lib/api";

// Stage 1 hosts the encounter shell's CortexProvider, whose live-patient
// streams never settle in jsdom — stub both pieces; stage 1's real
// machinery is covered by CortexShell's own tests.
vi.mock("../../../components/layout/CortexContext", () => ({
  CortexProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useCortex: () => ({
    soap: { subjective: "", objective: "", assessment: "", plan: "" },
    checklist: [], recording: false, elapsedSeconds: 0, transcript: [],
    orders: [], activeAgent: "scribe", messages: [], drawerOpen: true,
    postCare: null, postCareLoading: false, soapError: null, soapLoading: false,
    timeline: [], timelineLoading: false, timelineError: null,
    dictationMode: "live", patientId: "p1", transcribing: false, dictationError: null,
    toggleRecording: vi.fn(), updateSoap: vi.fn(), toggleChecklistItem: vi.fn(),
    setActiveAgent: vi.fn(), toggleDrawer: vi.fn(), runAgentAction: vi.fn(),
    setDictationMode: vi.fn(), appendTranscriptLine: vi.fn(),
    setTranscribing: vi.fn(), setDictationError: vi.fn(),
    refreshPostCare: vi.fn(), submitPreAuth: vi.fn(),
  }),
}));
vi.mock("../../../components/layout/panes/AiTeamDrawer", () => ({
  default: () => <div data-testid="ai-team-drawer-stub" />,
}));
vi.mock("../../../components/layout/panes/AmbientScribePane", () => ({
  default: () => <div data-testid="scribe-pane-stub" />,
}));

vi.mock("../../../lib/api", () => ({
  api: {
    patients: {
      suggestCodes: vi.fn().mockResolvedValue({ suggestions: [] }),
      addCondition: vi.fn(),
      // No saved notes by default: the stage falls back to the session draft, which is what the
      // tests below set up. The one test that covers the record path overrides this.
      listDrafts: vi.fn().mockResolvedValue({ data: [] }),
      serviceRequests: vi.fn().mockResolvedValue({ data: [] }),
      serviceRequestCandidates: vi.fn().mockResolvedValue({ data: [] }),
      matchQuickEntry: vi.fn().mockResolvedValue({ data: [] }),
      createServiceRequests: vi.fn(),
      orderCodingStatus: vi.fn().mockResolvedValue({ orders: [] }),
      confirmOrderCoding: vi.fn(),
      linkageStatus: vi.fn().mockResolvedValue({ orders: [], available_conditions: [] }),
      linkageVerdicts: vi.fn().mockResolvedValue({ pairs: [], graph_available: true }),
      linkDiagnosis: vi.fn(),
      claimReadiness: vi.fn().mockResolvedValue({ overall: "ready", checks: [] }),
      claimDraft: vi.fn().mockResolvedValue({ ready: false, blockers: [], bundle: null }),
      checkEligibility: vi.fn().mockResolvedValue({ status: "eligible" }),
      submitClaim: vi.fn(),
      listClaims: vi.fn().mockResolvedValue({ data: [] }),
    },
    drafts: {
      get: vi.fn(),
      update: vi.fn(),
      sign: vi.fn(),
      export: vi.fn(),
    },
  },
  ApiError: class ApiError extends Error {},
}));

const mocked = vi.mocked(api.patients);
// ServiceRequestPanel-style permissive default is unnecessary here; each
// test overrides the endpoints its stage touches.

const PATIENT = {
  id: "p1",
  mrn: "MRN-001",
  display_name: "Test Patient",
  date_of_birth: null,
  sex: null,
  preferred_language: null,
  ward: null,
  allergies: [],
  conditions: [{ id: "c1", code_display: "Abdominal pain", status: "active", onset_date: "2026-07-23" }],
} as unknown as PatientDetail;

function renderJourney(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <JourneyView patient={PATIENT} encounterId="e1" />
    </MemoryRouter>,
  );
}

// CortexProvider (stage 1) opens an SSE stream; jsdom has no EventSource.
class FakeEventSource {
  close(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

function gotoStage(id: string): void {
  fireEvent.click(screen.getByTestId(`journey-stage-${id}`));
}

describe("JourneyView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders the five-stage rail, the guardrail banner, and stage 1's scribe surface", () => {
    renderJourney();
    for (const id of ["document", "diagnose", "order", "codelink", "submit"]) {
      expect(screen.getByTestId(`journey-stage-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByText(/you approve/i)).toBeInTheDocument();
    expect(screen.getByTestId("scribe-pane-stub")).toBeInTheDocument();
  });

  it("stage 2 shows documented diagnoses as on-file and completes immediately", () => {
    renderJourney();
    gotoStage("diagnose");
    expect(screen.getByTestId("journey-stage-panel-diagnose")).toBeInTheDocument();
    expect(screen.getByText(/On file — 1 documented diagnosis/i)).toBeInTheDocument();
    // rail marks the stage done (data condition holds)
    expect(screen.getByTestId("journey-stage-diagnose").textContent).toContain("✓");
  });

  it("order candidates arrive PRE-SELECTED and one click creates the batch once", async () => {
    const candidate = {
      category: "procedure", code_system: "SBS", code: "ABC-1",
      code_display: "Colonoscopy", source_type: "note", source_document_id: "d1", source_excerpt: "colonoscopy",
    };
    mocked.serviceRequestCandidates.mockResolvedValue({ data: [candidate] } as never);
    mocked.matchQuickEntry.mockResolvedValue({ data: [] } as never);
    mocked.createServiceRequests.mockResolvedValue({ data: [] } as never);

    renderJourney();
    gotoStage("order");
    const box = await screen.findByLabelText("Colonoscopy") as HTMLInputElement;
    expect(box.checked).toBe(true); // pre-selected
    await userEvent.click(screen.getByTestId("create-selected-orders"));

    await waitFor(() => {
      expect(mocked.createServiceRequests).toHaveBeenCalledTimes(1);
    });
    expect(mocked.createServiceRequests).toHaveBeenCalledWith("p1", [candidate]);
  });

  it("veto empties the selection and disables creation", async () => {
    const candidate = {
      category: "lab", code_system: "SBS", code: "LAB-1",
      code_display: "CBC", source_type: "note", source_document_id: "d1", source_excerpt: "cbc",
    };
    mocked.serviceRequestCandidates.mockResolvedValue({ data: [candidate] } as never);
    mocked.matchQuickEntry.mockResolvedValue({ data: [] } as never);
    mocked.createServiceRequests.mockResolvedValue({ data: [] } as never);

    renderJourney();
    gotoStage("order");
    const box = await screen.findByLabelText("CBC") as HTMLInputElement;
    await userEvent.click(box); // veto
    expect(mocked.createServiceRequests).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-selected-orders")).toBeDisabled();
  });

  it("SBS suggestions arrive pre-selected; approve confirms each selected order", async () => {
    mocked.orderCodingStatus.mockResolvedValue({
      orders: [
        { service_request_id: "o1", order_display: "CBC", order_code: "LAB-1", category: "lab", requested_at: "2026-09-10", confirmed: null, suggestion: { sbs_code: "S1", sbs_display: "CBC" } },
        { service_request_id: "o2", order_display: "CRP", order_code: "LAB-2", category: "lab", requested_at: "2026-09-10", confirmed: null, suggestion: { sbs_code: "S2", sbs_display: "CRP" } },
      ],
    } as never);
    mocked.confirmOrderCoding.mockResolvedValue({} as never);
    mocked.linkageStatus.mockResolvedValue({ orders: [], available_conditions: [] } as never);
    mocked.linkageVerdicts.mockResolvedValue({ pairs: [], graph_available: true } as never);

    renderJourney();
    gotoStage("codelink");
    const cbc = await screen.findByLabelText("Confirm code for CBC") as HTMLInputElement;
    expect(cbc.checked).toBe(true); // pre-selected
    await userEvent.click(cbc); // veto CBC; approve only CRP
    await userEvent.click(screen.getByTestId("approve-selected-codes"));

    await waitFor(() => {
      expect(mocked.confirmOrderCoding).toHaveBeenCalledTimes(1);
    });
    expect(mocked.confirmOrderCoding).toHaveBeenCalledWith("p1", "o2");
  });

  it("linkage chips are never pre-selected — the clinician taps each link", async () => {
    mocked.orderCodingStatus.mockResolvedValue({ orders: [] } as never);
    mocked.linkageStatus.mockResolvedValue({
      orders: [{
        service_request_id: "o1", order_display: "Colonoscopy", category: "procedure",
        requested_at: "2026-09-10", linked: [],
      }],
      available_conditions: [{ condition_id: "c1", condition_display: "Abdominal pain", onset_date: "2026-07-23" }],
    } as never);
    mocked.linkageVerdicts.mockResolvedValue({
      pairs: [{ order_id: "o1", condition_id: "c1", status: "GREEN", pre_auth_required: false }],
      graph_available: true,
    } as never);
    mocked.linkDiagnosis.mockResolvedValue({ ok: true } as never);

    renderJourney();
    gotoStage("codelink");
    const row = await screen.findByTestId("linkage-row-o1");
    const chip = within(row).getByRole("button", { name: /Abdominal pain/ });
    // verdict dot is information only — no checkbox, no pre-selection
    expect(within(row).queryByRole("checkbox")).toBeNull();
    expect(chip).toBeInTheDocument();
    expect(chip.textContent).toContain("Abdominal pain");

    await userEvent.click(chip);
    await waitFor(() => {
      expect(mocked.linkDiagnosis).toHaveBeenCalledWith("p1", "o1", "c1");
    });
  });

  it("submit is disabled until the claim draft is ready, then submits once", async () => {
    mocked.claimReadiness.mockResolvedValue({ overall: "ready", checks: [] } as never);
    mocked.claimDraft.mockResolvedValue({ ready: true, blockers: [], bundle: {} } as never);
    mocked.checkEligibility.mockResolvedValue({ status: "eligible" } as never);
    mocked.submitClaim.mockResolvedValue({ id: "cl1", status: "accepted", rejection_codes: [], mode: "stub", submitted_at: "now", item_count: 3 } as never);

    renderJourney();
    gotoStage("submit");
    const btn = await screen.findByTestId("submit-claim");
    await waitFor(() => expect(btn).toBeEnabled());
    await userEvent.click(btn);
    await waitFor(() => {
      expect(mocked.submitClaim).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByTestId("submit-msg")).toBeInTheDocument();
  });

  it("submit stays disabled while blockers remain", async () => {
    mocked.claimReadiness.mockResolvedValue({ overall: "blocked", checks: [] } as never);
    mocked.claimDraft.mockResolvedValue({ ready: false, blockers: ["link orders"], bundle: null } as never);

    renderJourney();
    gotoStage("submit");
    const btn = await screen.findByTestId("submit-claim");
    await waitFor(() => expect(btn).toBeDisabled());
    expect(mocked.submitClaim).not.toHaveBeenCalled();
  });

  it("auto-runs eligibility exactly once on entering the submit stage", async () => {
    mocked.claimReadiness.mockResolvedValue({ overall: "ready", checks: [] } as never);
    mocked.claimDraft.mockResolvedValue({ ready: true, blockers: [], bundle: {} } as never);
    mocked.checkEligibility.mockResolvedValue({ status: "eligible" } as never);

    renderJourney();
    gotoStage("submit");
    gotoStage("order"); // leave and come back
    gotoStage("submit");
    await waitFor(() => {
      expect(mocked.checkEligibility).toHaveBeenCalledTimes(1);
    });
  });

  it("resumes at the persisted stage after a remount", () => {
    sessionStorage.setItem("journey.stage.p1", "codelink");
    const { unmount } = renderJourney();
    unmount();
    renderJourney();
    expect(screen.getByTestId("journey-stage-panel-codelink")).toBeInTheDocument();
  });

  // Reported with a screenshot: the step read "the SOAP assessment was analyzed automatically"
  // above an empty space, so a wording gap looked like a broken step. Silence is not a status.
  it("says so when the assessment matched nothing", async () => {
    sessionStorage.setItem(`cortex.scribe.${PATIENT.id}`, JSON.stringify({ soap: { assessment: "zzz unknown wording zzz", plan: "" } }));
    renderJourney();
    gotoStage("diagnose");
    expect(await screen.findByText(/Nothing in the assessment matched the coded vocabulary/i)).toBeInTheDocument();
  });

  // Item 3 of the consolidation plan: a stage with nothing to decide says so and offers the way on.
  // The runbook calls this stage "usually nothing to add", yet the only thing it ever said was
  // "nothing matched" — which reads as a failure and sent the clinician to another surface to finish
  // a step they were already standing in. Now it says nothing-to-add and offers the next stage.
  it("says nothing to add, and offers the way on, when the note raises nothing new", async () => {
    sessionStorage.setItem(
      `cortex.scribe.${PATIENT.id}`,
      JSON.stringify({ soap: { assessment: "zzz unknown wording zzz", plan: "" } }),
    );
    renderJourney();
    gotoStage("diagnose");

    expect(await screen.findByTestId("diagnose-nothing-to-do")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to Order/i })).toBeInTheDocument();
  });

  // G10: when the note's wording is not in the curated vocabulary, the clinician had to leave the
  // wizard and add the diagnosis on another surface. The box searches the vocabulary here, merges the
  // result into the SAME list the matcher fills, and the one "Add selected" button writes it — so the
  // write path is unchanged and no new endpoint is needed.
  it("finds a term through the vocabulary search and adds it with the same button", async () => {
    sessionStorage.setItem(
      `cortex.scribe.${PATIENT.id}`,
      JSON.stringify({ soap: { assessment: "zzz unmatched wording zzz", plan: "" } }),
    );
    // Answer by query, not by call order: the mount analysis also calls this endpoint, so a
    // once-mock would be consumed before the search ever ran.
    mocked.suggestCodes.mockImplementation((q: string) =>
      Promise.resolve(
        q.toLowerCase().includes("urinary")
          ? {
              suggestions: [
                {
                  code: "68566005",
                  code_display: "Urinary tract infection",
                  code_system: "http://snomed.info/sct",
                },
              ],
            }
          : { suggestions: [] },
      ) as never,
    );
    mocked.addCondition.mockResolvedValueOnce({
      id: "c2",
      code: "68566005",
      code_display: "Urinary tract infection",
      status: "active",
    } as never);

    renderJourney();
    gotoStage("diagnose");
    await userEvent.type(screen.getByTestId("diagnose-vocabulary-search"), "urinary");

    expect(await screen.findByText("Urinary tract infection")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Add selected/i }));
    await waitFor(() =>
      expect(mocked.addCondition).toHaveBeenCalledWith(
        PATIENT.id,
        expect.objectContaining({ code: "68566005", encounter_id: "e1" }),
      ),
    );
  });

  // The honest half of G10: the list is curated, so a term it lacks is a vocabulary gap. The system
  // says that rather than inventing a code — the same rule that stopped the fabricated SBS codes.
  it("names a vocabulary gap instead of inventing a term when nothing matches", async () => {
    renderJourney();
    gotoStage("diagnose");
    mocked.suggestCodes.mockResolvedValue({ suggestions: [] } as never);

    await userEvent.type(screen.getByTestId("diagnose-vocabulary-search"), "zzz");

    expect(await screen.findByTestId("diagnose-search-note")).toHaveTextContent(/vocabulary gap/i);
  });

  // Item 3 for stage 4 — the same treatment stage 2 got. The stage reported each clean half on its
  // own but never said the useful thing: that there is nothing left to approve and the next stage is
  // waiting. This case is the one an encounter with no orders at all used to render as a blank stage.
  it("says so on stage 4 when there is nothing to code or link, and offers the way on", async () => {
    renderJourney();
    gotoStage("codelink");

    expect(await screen.findByTestId("codelink-nothing-to-do")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to Submit/i })).toBeInTheDocument();
  });

  // ...and the same treatment when there ARE orders but nothing left to decide: the "every order is
  // coded and linked" case. Before this the clinician had to infer from two separate quiet messages
  // that the stage was finished with them.
  it("says nothing to approve on stage 4 when every order is coded and linked", async () => {
    mocked.orderCodingStatus.mockResolvedValue({
      orders: [
        {
          service_request_id: "o1",
          order_display: "ECG",
          order_code: "11700-00-00",
          category: "procedure",
          requested_at: "2026-09-10",
          confirmed: "11700-00-00",
          suggestion: { sbs_code: "11700-00-00", sbs_display: "ECG" },
        },
      ],
    } as never);
    mocked.linkageStatus.mockResolvedValue({
      orders: [
        {
          service_request_id: "o1",
          order_display: "ECG",
          category: "procedure",
          requested_at: "2026-09-10",
          linked: [{ condition_id: "c1", condition_display: "Abdominal pain" }],
        },
      ],
      available_conditions: [],
    } as never);

    renderJourney();
    gotoStage("codelink");

    expect(await screen.findByText(/Nothing to approve — every order is coded and linked/i)).toBeInTheDocument();
  });

  // Item 5 of the consolidation plan: the confirmed diagnosis carries its provenance. Without the
  // encounter on the write, the problem list cannot answer "what was this visit for?" from the
  // record — the gap that started this whole assessment — and the claim has no encounter-level
  // justification to point at. The id is invisible to the clinician: nothing extra to press.
  it("records the encounter on the confirmed diagnosis", async () => {
    sessionStorage.setItem(
      `cortex.scribe.${PATIENT.id}`,
      JSON.stringify({ soap: { assessment: "type 2 diabetes", plan: "" } }),
    );
    mocked.suggestCodes.mockResolvedValueOnce({
      suggestions: [
        { code: "44054006", code_display: "Diabetes mellitus type 2", code_system: "http://snomed.info/sct" },
      ],
    } as never);
    mocked.addCondition.mockResolvedValueOnce({
      id: "c1",
      code: "44054006",
      code_display: "Diabetes mellitus type 2",
      status: "active",
    } as never);

    renderJourney();
    gotoStage("diagnose");

    const add = await screen.findByRole("button", { name: /Add selected/i });
    await userEvent.click(add);

    await waitFor(() =>
      expect(mocked.addCondition).toHaveBeenCalledWith(
        PATIENT.id,
        expect.objectContaining({ encounter_id: "e1" }),
      ),
    );
  });

  // Item 1 of the consolidation plan: the step analyses the SAVED note first. Reading the session
  // alone made the stage depend on the tab staying open — closing it emptied the stage while the
  // note sat on the record, which is exactly how the gap was reported.
  it("analyses the saved note, not only the browser session", async () => {
    sessionStorage.setItem(
      `cortex.scribe.${PATIENT.id}`,
      JSON.stringify({ soap: { assessment: "wording only in the session", plan: "" } }),
    );
    mocked.listDrafts.mockResolvedValueOnce({
      data: [
        {
          id: "d1",
          document_type: "encounter_note",
          language: "en",
          status: "draft",
          created_at: "2026-09-19T10:00:00Z",
          signed_at: null,
        },
      ],
    } as never);
    vi.mocked(api.drafts.get).mockResolvedValueOnce({
      sections_json: [
        { key: "assessment", title: "Assessment", policy: "clinician_authored_only", text: "type 2 diabetes" },
      ],
    } as never);
    mocked.suggestCodes.mockClear();

    renderJourney();
    gotoStage("diagnose");

    await waitFor(() => expect(mocked.suggestCodes).toHaveBeenCalledWith("type 2 diabetes"));
  });

  it("says so when the note has no assessment yet", () => {
    renderJourney();
    gotoStage("diagnose");
    expect(screen.getByText(/has no assessment yet/i)).toBeInTheDocument();
  });
});
