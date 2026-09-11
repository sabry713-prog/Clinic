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

// Stage 1 hosts the encounter shell's SullyProvider, whose live-patient
// streams never settle in jsdom — stub both pieces; stage 1's real
// machinery is covered by SullyShell's own tests.
vi.mock("../../../components/layout/SullyContext", () => ({
  SullyProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSully: () => ({
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
vi.mock("../../../components/layout/panes/AmbientScribePane", () => ({
  default: () => <div data-testid="scribe-pane-stub" />,
}));

vi.mock("../../../lib/api", () => ({
  api: {
    patients: {
      suggestCodes: vi.fn().mockResolvedValue({ suggestions: [] }),
      addCondition: vi.fn(),
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

// SullyProvider (stage 1) opens an SSE stream; jsdom has no EventSource.
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
});
