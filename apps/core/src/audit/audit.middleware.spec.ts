import type { Pool } from "pg";

// Mock the audit package
jest.mock("@clinical-copilot/audit", () => ({
  writeAuditEvent: jest.fn().mockResolvedValue({ id: "test-id", hash_self: "abc" }),
}));

import { writeAuditEvent } from "@clinical-copilot/audit";
import { AuditMiddleware } from "./audit.middleware";

describe("AuditMiddleware", () => {
  let middleware: AuditMiddleware;
  let mockPool: jest.Mocked<Pool>;

  beforeEach(() => {
    mockPool = {} as jest.Mocked<Pool>;
    middleware = new AuditMiddleware(mockPool);
  });

  it("calls writeAuditEvent on response finish for non-health routes", (done) => {
    const mockReq = {
      headers: {},
      method: "GET",
      path: "/api/v1/patients",
      originalUrl: "/api/v1/patients",
      cookies: {},
      requestId: undefined as string | undefined,
      authenticatedUserId: undefined as string | undefined,
      authenticatedUserRole: undefined as string | undefined,
    } as unknown as import("express").Request;

    const listeners: Record<string, () => void> = {};
    const mockRes = {
      setHeader: jest.fn(),
      statusCode: 200,
      on: jest.fn((event: string, cb: () => void) => {
        listeners[event] = cb;
      }),
    } as unknown as import("express").Response;

    const next = jest.fn();

    middleware.use(mockReq, mockRes, next);

    expect(next).toHaveBeenCalled();

    // Trigger finish event
    listeners["finish"]?.();

    // Wait for async audit write
    setTimeout(() => {
      expect(writeAuditEvent).toHaveBeenCalledWith(
        mockPool,
        expect.objectContaining({
          action: expect.stringContaining("HTTP_GET"),
          outcome: "SUCCESS",
        }),
      );
      done();
    }, 10);
  });

  it("skips audit for /api/v1/health", (done) => {
    (writeAuditEvent as jest.Mock).mockClear();

    const mockReq = {
      headers: {},
      method: "GET",
      path: "/api/v1/health",
      originalUrl: "/api/v1/health",
      cookies: {},
    } as unknown as import("express").Request;

    const listeners: Record<string, () => void> = {};
    const mockRes = {
      setHeader: jest.fn(),
      statusCode: 200,
      on: jest.fn((event: string, cb: () => void) => {
        listeners[event] = cb;
      }),
    } as unknown as import("express").Response;

    middleware.use(mockReq, mockRes, jest.fn());
    listeners["finish"]?.();

    setTimeout(() => {
      expect(writeAuditEvent).not.toHaveBeenCalled();
      done();
    }, 10);
  });
});
