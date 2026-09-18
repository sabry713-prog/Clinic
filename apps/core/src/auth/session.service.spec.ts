/**
 * M02 (readiness assessment): session revocation and role-drift tests.
 *
 * The session service must check the user's live DB state on every
 * authenticated request:
 * - A disabled user's session is rejected immediately
 * - A role change updates the session's roles from the authoritative source
 * - A user removed from the DB is rejected (fail closed)
 * - A DB failure rejects the session (fail closed, never stale auth)
 */

import { SessionService } from "./session.service";

/** An in-memory stand-in for the shared store (Redis in production). */
interface FakeStore {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  /** raw key/value view, so a test can plant an entry the service would refuse */
  entries: Map<string, string>;
}

function makeStore(): FakeStore {
  const entries = new Map<string, string>();
  return {
    entries,
    get: jest.fn((key: string) => Promise.resolve(entries.has(key) ? entries.get(key)! : null)),
    set: jest.fn((key: string, value: string) => {
      entries.set(key, value);
      return Promise.resolve("OK");
    }),
    del: jest.fn((key: string) => Promise.resolve(entries.delete(key) ? 1 : 0)),
  };
}

function makePool(result: unknown): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool: any;
  service: SessionService;
  store: FakeStore;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = jest.fn();
  if (result instanceof Error) {
    query.mockRejectedValue(result);
  } else {
    query.mockResolvedValue(result);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pool: any = { query };
  const store = makeStore();
  const service = new SessionService(pool, store as never);
  return { pool, service, store };
}

function sessionData(roles: string[]): Parameters<SessionService["create"]>[0] {
  return {
    userId: "u-1",
    tenantId: "00000000-0000-0000-0000-000000000001",
    externalSubject: "sub-1",
    displayName: "Test",
    email: null,
    preferredLanguage: "en",
    roles,
    accessToken: "",
    refreshToken: null,
    expiresAt: new Date(Date.now() + 60_000),
  };
}

describe("SessionService — M02 live authorization check", () => {
  it("reads disablement from the real schema column (regression: phantom u.enabled)", async () => {
    // The original M02 query selected `u.enabled`, which does not exist on
    // app."user" (disablement is modelled as `disabled_at`). The query threw on
    // every request, the service failed closed, and the UI looped back to the
    // login page. Mocked rows can never catch that, so assert on the SQL text.
    const { pool, service } = makePool({ rows: [{ enabled: true, role: "physician" }] });
    const sid = await service.create(sessionData(["physician"]));
    await service.get(sid);
    const sql = String(pool.query.mock.calls[0][0]);
    expect(sql).toContain("disabled_at");
    expect(sql).not.toMatch(/SELECT\s+u\.enabled/);
  });

  it("returns the session when the user is enabled and roles match", async () => {
    const { service } = makePool({ rows: [{ enabled: true, role: "physician" }] });
    const sid = await service.create(sessionData(["physician"]));
    const result = await service.get(sid);
    expect(result).not.toBeNull();
    expect(result!.roles).toEqual(["physician"]);
  });

  it("rejects a disabled user's session immediately", async () => {
    const { service } = makePool({ rows: [{ enabled: false, role: "physician" }] });
    const sid = await service.create(sessionData(["physician"]));
    const result = await service.get(sid);
    expect(result).toBeNull();
    // the session is deleted, not just rejected
    expect(service.get(sid)).resolves.toBeNull();
  });

  it("updates the session roles when the DB roles changed", async () => {
    // Session created as physician; DB now says admin
    const { service } = makePool({ rows: [{ enabled: true, role: "hospital_admin" }] });
    const sid = await service.create(sessionData(["physician"]));
    const result = await service.get(sid);
    expect(result).not.toBeNull();
    expect(result!.roles).toEqual(["hospital_admin"]);
  });

  it("rejects when the user no longer exists in the DB (fail closed)", async () => {
    const { service } = makePool({ rows: [] });
    const sid = await service.create(sessionData(["physician"]));
    const result = await service.get(sid);
    expect(result).toBeNull();
  });

  it("rejects when the DB is unreachable (fail closed, never stale auth)", async () => {
    const { service } = makePool(new Error("connection refused"));
    const sid = await service.create(sessionData(["physician"]));
    const result = await service.get(sid);
    expect(result).toBeNull();
  });

  it("refuses to create an already-expired session", async () => {
    const { service } = makePool({ rows: [{ enabled: true, role: "physician" }] });
    const expired = { ...sessionData(["physician"]), expiresAt: new Date(Date.now() - 1000) };
    await expect(service.create(expired)).rejects.toThrow(/already-expired/);
  });

  it("rejects an expired session without querying the DB", async () => {
    const { service, pool, store } = makePool({ rows: [{ enabled: true, role: "physician" }] });
    // planted directly: create() refuses an expired session, and the store can
    // still hold one that ran out of time after being written
    const expired = { ...sessionData(["physician"]), expiresAt: new Date(Date.now() - 1000) };
    store.entries.set("session:expired-1", JSON.stringify(expired));

    const result = await service.get("expired-1");

    expect(result).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
    // and it is cleaned out of the store rather than left to linger
    expect(store.del).toHaveBeenCalledWith("session:expired-1");
  });
});
