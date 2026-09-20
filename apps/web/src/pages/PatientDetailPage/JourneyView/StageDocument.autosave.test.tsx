/**
 * Stage 1's working copy persists itself (consolidation item 2).
 *
 * The button it replaced ("Save note to record") created a NEW draft on every press: the note only
 * reached the record when someone remembered to press it, and pressing twice duplicated it. These
 * tests pin the replacement — save as you write, into ONE draft, with nothing signed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import StageDocument from "./StageDocument";
import { api } from "../../../lib/api";

vi.mock("../../../components/layout/CortexContext", () => ({
  CortexProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useCortex: () => ({
    soap: {
      subjective: "cough for three days",
      objective: "",
      assessment: "acute bronchitis",
      plan: "",
    },
    transcript: [{ id: "t1", speaker: "clinician", text: "what brings you in" }],
  }),
}));
vi.mock("../../../components/layout/panes/AmbientScribePane", () => ({
  default: () => <div data-testid="scribe-pane-stub" />,
}));
vi.mock("../../../lib/api", () => ({
  api: {
    patients: { listDrafts: vi.fn(), createDraft: vi.fn() },
    drafts: { updateSections: vi.fn() },
  },
  ApiError: class ApiError extends Error {},
}));

const mocked = vi.mocked(api.patients);
const drafts = vi.mocked(api.drafts);

describe("StageDocument — the working copy saves itself", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocked.listDrafts.mockResolvedValue({ data: [] } as never);
    mocked.createDraft.mockResolvedValue({ id: "d1" } as never);
    drafts.updateSections.mockResolvedValue({ id: "d1" } as never);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates the draft once, without waiting to be asked", async () => {
    render(<StageDocument patientId="p1" onDone={vi.fn()} />);

    await vi.advanceTimersByTimeAsync(2_600);

    expect(mocked.listDrafts).toHaveBeenCalledWith("p1");
    expect(mocked.createDraft).toHaveBeenCalledTimes(1);
    // The clinician's own words, sent as authored — no transcript to be a substring of.
    const [, , , , prefill] = mocked.createDraft.mock.calls[0]!;
    expect(prefill?.authoredSections).toEqual([
      { key: "subjective", text: "cough for three days" },
      { key: "assessment", text: "acute bronchitis" },
    ]);
  });

  it("updates that same draft on a later save instead of creating another", async () => {
    mocked.listDrafts.mockResolvedValue({
      data: [
        { id: "d9", document_type: "encounter_note", status: "draft", created_at: "2026-09-19T10:00:00Z" },
      ],
    } as never);

    render(<StageDocument patientId="p1" onDone={vi.fn()} />);
    await vi.advanceTimersByTimeAsync(2_600);

    expect(mocked.createDraft).not.toHaveBeenCalled();
    expect(drafts.updateSections).toHaveBeenCalledWith(
      "d9",
      expect.arrayContaining([{ key: "assessment", text: "acute bronchitis" }]),
    );
    // All four keys every time, so clearing a field clears its section rather than leaving stale text.
    const [, sections] = drafts.updateSections.mock.calls[0]!;
    expect((sections as unknown as { key: string }[]).map((s) => s.key)).toEqual([
      "subjective",
      "objective",
      "assessment",
      "plan",
    ]);
  });

  it("says it is a working copy, not signed documentation", async () => {
    // onAdvance is what offers the way on once there is something on the record, so it has to be
    // present for this assertion to mean anything.
    render(<StageDocument patientId="p1" onDone={vi.fn()} onAdvance={vi.fn()} />);
    await vi.advanceTimersByTimeAsync(2_600);

    // No waitFor here: with fake timers it would block on real time. The save resolves inside
    // advanceTimersByTimeAsync above, so the state is already flushed.
    expect(screen.getByTestId("note-autosave")).toHaveTextContent(/not signed/i);
    expect(screen.getByRole("button", { name: /Continue to Diagnose/i })).toBeInTheDocument();
  });
});
