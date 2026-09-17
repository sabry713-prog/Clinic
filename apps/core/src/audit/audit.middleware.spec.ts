import type { Pool } from "pg";
import { AuditMiddleware } from "./audit.middleware";
import type { AuditOutboxService } from "./audit-outbox.service";

describe("AuditMiddleware", () => {
  let middleware: AuditMiddleware;
  let mockPool: jest.Mocked<Pool>;
  let outbox: { enqueue: jest.Mock };

  beforeEach(() => {
    mockPool = {} as jest.Mocked<Pool>;
    outbox = { enqueue: jest.fn().mockResolvedValue("outbox-1") };
    middleware = new AuditMiddleware(mockPool, outbox as unknown as AuditOutboxService);
  });

  function fakeExchange(path: string, statusCode = 200) {
    const mockReq = {
      headers: {},
      method: "GET",
      path,
      originalUrl: path,
      cookies: {},
      requestId: undefined as string | undefined,
      authenticatedUserId: undefined as string | undefined,
      authenticatedUserRole: undefined as string | undefined,
    } as unknown as import("express").Request;

    const listeners: Record<string, () => void> = {};
    const mockRes = {
      setHeader: jest.fn(),
      statusCode,
      on: jest.fn((event: string, cb: () => void) => {
        listeners[event] = cb;
      }),
    } as unknown as import("express").Response;

    return { mockReq, mockRes, listeners };
  }

  // M08: the event is handed to the durable outbox rather than written from the
  // response handler, where a lost write was only a log line.
  it("enqueues the audit event on response finish for non-health routes", (done) => {
    const { mockReq, mockRes, listeners } = fakeExchange("/api/v1/patients");

    const next = jest.fn();
    middleware.use(mockReq, mockRes, next);
    expect(next).toHaveBeenCalled();

    listeners.finish?.();

    setTimeout(() => {
      expect(outbox.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          action: expect.stringContaining("HTTP_GET"),
          outcome: "SUCCESS",
        }),
      );
      done();
    }, 10);
  });

  it("skips audit for /api/v1/health", (done) => {
    const { mockReq, mockRes, listeners } = fakeExchange("/api/v1/health");

    middleware.use(mockReq, mockRes, jest.fn());
    listeners.finish?.();

    setTimeout(() => {
      expect(outbox.enqueue).not.toHaveBeenCalled();
      done();
    }, 10);
  });

  it("classifies 401/403 as REFUSED and 5xx as FAILURE", (done) => {
    const refused = fakeExchange("/api/v1/patients/abc", 403);
    middleware.use(refused.mockReq, refused.mockRes, jest.fn());
    refused.listeners.finish?.();

    const failure = fakeExchange("/api/v1/patients", 503);
    middleware.use(failure.mockReq, failure.mockRes, jest.fn());
    failure.listeners.finish?.();

    setTimeout(() => {
      expect(outbox.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "REFUSED", target_type: null }),
      );
      expect(outbox.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "FAILURE" }),
      );
      done();
    }, 10);
  });

  it("never puts the query string or body in the audit metadata", (done) => {
    const { mockReq, mockRes, listeners } = fakeExchange("/api/v1/patients/abc");
    (mockReq as unknown as { query: unknown }).query = { national_id: "1234567890" };
    (mockReq as unknown as { body: unknown }).body = { note: "sensitive free text" };

    middleware.use(mockReq, mockRes, jest.fn());
    listeners.finish?.();

    setTimeout(() => {
      const payload = outbox.enqueue.mock.calls[0][0] as {
        metadata_json: Record<string, unknown>;
      };
      const serialised = JSON.stringify(payload.metadata_json);
      expect(serialised).not.toContain("1234567890");
      expect(serialised).not.toContain("sensitive free text");
      done();
    }, 10);
  });

  it("dead-letters to stderr only when the outbox cannot be reached", (done) => {
    const write = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    outbox.enqueue.mockRejectedValueOnce(new Error("database is down"));

    const { mockReq, mockRes, listeners } = fakeExchange("/api/v1/patients");
    middleware.use(mockReq, mockRes, jest.fn());
    listeners.finish?.();

    setTimeout(() => {
      const lines = write.mock.calls.map((c) => String(c[0]));
      const dead = lines.find((l) => l.includes("dead_letter"));
      expect(dead).toBeDefined();
      expect(dead).toContain("HTTP_GET");
      write.mockRestore();
      done();
    }, 20);
  });
});
