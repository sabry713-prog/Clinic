/**
 * useNphiesStatus tests (Sprint 9).
 *
 * jsdom has no EventSource, so a minimal fake stands in — same approach as
 * useAgentOrchestrator.test.ts. The important assertions are that an undecided
 * payer response never presents as approved, and that events are routed per
 * order rather than overwriting each other.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useNphiesStatus } from "./useNphiesStatus";

type Listener = (event: { data?: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
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

function latest(): FakeEventSource {
  const s = FakeEventSource.instances.at(-1);
  if (!s) throw new Error("no EventSource constructed");
  return s;
}

const APPROVED = {
  event: "nphies_status_updated",
  encounter_id: "enc-1",
  order_id: "order-3",
  status: "approved",
  authorization_number: "PA-2026-0001",
  mode: "live",
};

describe("useNphiesStatus", () => {
  it("does not connect without both patient and encounter", () => {
    renderHook(() => useNphiesStatus(null, "enc-1"));
    renderHook(() => useNphiesStatus("pat-1", null));
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("subscribes scoped to the encounter", () => {
    renderHook(() => useNphiesStatus("pat-1", "enc-1"));
    expect(latest().url).toContain("/patients/pat-1/nphies/pre-auth/stream");
    expect(latest().url).toContain("encounter_id=enc-1");
  });

  it("records an approval with its authorization number", async () => {
    const { result } = renderHook(() => useNphiesStatus("pat-1", "enc-1"));
    act(() => latest().emit("nphies_status_updated", APPROVED));
    await waitFor(() =>
      expect(result.current.byOrder["order-3"]?.authorization_number).toBe("PA-2026-0001"),
    );
  });

  it("keeps a pended response distinct from approved", async () => {
    const { result } = renderHook(() => useNphiesStatus("pat-1", "enc-1"));
    act(() =>
      latest().emit("nphies_status_updated", {
        ...APPROVED,
        status: "pended",
        authorization_number: null,
      }),
    );
    await waitFor(() => expect(result.current.byOrder["order-3"]?.status).toBe("pended"));
    expect(result.current.byOrder["order-3"]?.authorization_number).toBeNull();
  });

  it("routes events per order rather than overwriting", async () => {
    const { result } = renderHook(() => useNphiesStatus("pat-1", "enc-1"));
    act(() => {
      latest().emit("nphies_status_updated", APPROVED);
      latest().emit("nphies_status_updated", { ...APPROVED, order_id: "order-4", status: "pended" });
    });
    await waitFor(() => expect(Object.keys(result.current.byOrder)).toHaveLength(2));
    expect(result.current.byOrder["order-3"]?.status).toBe("approved");
    expect(result.current.byOrder["order-4"]?.status).toBe("pended");
  });

  it("keeps encounter-level eligibility events separate from order state", async () => {
    const { result } = renderHook(() => useNphiesStatus("pat-1", "enc-1"));
    act(() =>
      latest().emit("nphies_status_updated", {
        event: "nphies_status_updated",
        encounter_id: "enc-1",
        order_id: null,
        status: "eligible",
      }),
    );
    await waitFor(() => expect(result.current.encounterEvent?.status).toBe("eligible"));
    expect(result.current.byOrder).toEqual({});
  });

  it("treats the initial connected event as connection state, not an outcome", async () => {
    const { result } = renderHook(() => useNphiesStatus("pat-1", "enc-1"));
    act(() =>
      latest().emit("nphies_status_updated", {
        event: "nphies_status_updated",
        encounter_id: "enc-1",
        order_id: null,
        status: "connected",
      }),
    );
    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(result.current.encounterEvent).toBeNull();
  });

  it("markQueued flags an order as in flight immediately", async () => {
    const { result } = renderHook(() => useNphiesStatus("pat-1", "enc-1"));
    act(() => result.current.markQueued("order-3"));
    await waitFor(() => expect(result.current.byOrder["order-3"]?.status).toBe("queued"));
  });

  it("ignores malformed payloads instead of crashing the stream", () => {
    const { result } = renderHook(() => useNphiesStatus("pat-1", "enc-1"));
    expect(() => act(() => latest().emit("nphies_status_updated"))).not.toThrow();
    expect(result.current.byOrder).toEqual({});
  });

  it("surfaces a connection error", async () => {
    const { result } = renderHook(() => useNphiesStatus("pat-1", "enc-1"));
    act(() => latest().emit("error"));
    await waitFor(() =>
      expect(result.current.error).toBe("Lost connection to the NPHIES status stream."),
    );
  });

  it("closes the stream on unmount", () => {
    const { unmount } = renderHook(() => useNphiesStatus("pat-1", "enc-1"));
    const source = latest();
    unmount();
    expect(source.closed).toBe(true);
  });
});
