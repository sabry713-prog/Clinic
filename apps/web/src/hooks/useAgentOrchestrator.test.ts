/**
 * useAgentOrchestrator tests.
 *
 * jsdom has no EventSource implementation, so a minimal FakeEventSource
 * stands in for it -- same "patch the boundary" approach used for network
 * calls elsewhere in this app's tests. Each test drives the fake by name
 * (open/agent_update/done/error) and asserts the hook's exposed state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAgentOrchestrator } from "./useAgentOrchestrator";

type Listener = (event: { data?: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readonly withCredentials: boolean;
  closed = false;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(url: string, opts?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = opts?.withCredentials ?? false;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data?: unknown): void {
    const payload = data === undefined ? {} : { data: JSON.stringify(data) };
    for (const listener of this.listeners.get(type) ?? []) listener(payload);
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function latestSource(): FakeEventSource {
  const source = FakeEventSource.instances.at(-1);
  if (!source) throw new Error("no EventSource was constructed");
  return source;
}

const PHARMACIST_RESULT = {
  agent: "pharmacist",
  patient_id: "patient-1",
  prose: "Metformin dose adjusted for reduced renal function.",
  findings: { drug_interactions: [], dose_safety: [] },
  evidence_chains: [],
};

describe("useAgentOrchestrator", () => {
  it("does not connect when patientId is null", () => {
    renderHook(() => useAgentOrchestrator(null));
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("opens a connection scoped to the given patientId", () => {
    renderHook(() => useAgentOrchestrator("patient-1"));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(latestSource().url).toContain("/patients/patient-1/ai-team/stream");
    expect(latestSource().withCredentials).toBe(true);
  });

  it("sets connected on the open event", async () => {
    const { result } = renderHook(() => useAgentOrchestrator("patient-1"));
    expect(result.current.connected).toBe(false);
    latestSource().emit("open");
    await waitFor(() => expect(result.current.connected).toBe(true));
  });

  it("routes a pharmacist agent_update to pharmacist state only", async () => {
    const { result } = renderHook(() => useAgentOrchestrator("patient-1"));
    latestSource().emit("agent_update", PHARMACIST_RESULT);
    await waitFor(() => expect(result.current.pharmacist).toEqual(PHARMACIST_RESULT));
    expect(result.current.consultant).toBeNull();
    expect(result.current.nphies).toBeNull();
  });

  it("closes and disconnects on the done event", async () => {
    const { result } = renderHook(() => useAgentOrchestrator("patient-1"));
    const source = latestSource();
    source.emit("open");
    await waitFor(() => expect(result.current.connected).toBe(true));
    source.emit("done");
    await waitFor(() => expect(result.current.connected).toBe(false));
    expect(source.closed).toBe(true);
  });

  it("surfaces a connection error", async () => {
    const { result } = renderHook(() => useAgentOrchestrator("patient-1"));
    latestSource().emit("error");
    await waitFor(() => expect(result.current.error).toBe("Lost connection to the AI Team agents."));
    expect(result.current.connected).toBe(false);
  });

  it("ignores malformed agent_update payloads instead of crashing", () => {
    const { result } = renderHook(() => useAgentOrchestrator("patient-1"));
    const source = latestSource();
    expect(() => source.emit("agent_update")).not.toThrow();
    expect(result.current.pharmacist).toBeNull();
  });

  it("resets state and closes the connection when patientId changes to null", async () => {
    const { result, rerender } = renderHook(
      ({ patientId }: { patientId: string | null }) => useAgentOrchestrator(patientId),
      { initialProps: { patientId: "patient-1" as string | null } },
    );
    const source = latestSource();
    source.emit("agent_update", PHARMACIST_RESULT);
    await waitFor(() => expect(result.current.pharmacist).toEqual(PHARMACIST_RESULT));

    rerender({ patientId: null });
    expect(source.closed).toBe(true);
    expect(result.current.pharmacist).toBeNull();
    expect(result.current.connected).toBe(false);
  });
});
