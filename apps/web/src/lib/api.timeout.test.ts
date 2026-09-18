import { describe, it, expect, vi, afterEach } from "vitest";
import { request, ApiError } from "./api";

/**
 * H03: the shared client had no deadline, so a hung service left a clinician staring
 * at a spinner with nothing to act on. These pin the three things that matter: a hung
 * request fails rather than hangs, the failure is typed and marked retryable, and a
 * caller's own signal is honoured rather than replaced by the default deadline.
 */
function neverAnswers(): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        (init as RequestInit | undefined)?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "TimeoutError")),
        );
      }),
  );
}

function answers(body: unknown = { data: [], next_cursor: null, total: null }) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the shared client's deadline", () => {
  it("fails with a typed, retryable error instead of hanging", async () => {
    neverAnswers();
    const err = await request("/api/v1/patients/p-1", { timeoutMs: 5 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "TIMEOUT", status: 0 });
    expect((err as ApiError).retryable).toBe(true);
  });

  it("gives every call a signal even when the caller passes none", async () => {
    const spy = answers();
    await request("/api/v1/patients/p-1");
    const init = spy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not replace a caller's own signal", async () => {
    const own = new AbortController();
    const spy = answers();
    await request("/api/v1/patients/p-1", { signal: own.signal });
    const init = spy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBe(own.signal);
  });
});
