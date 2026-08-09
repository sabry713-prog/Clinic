/**
 * Unit tests for RefillRequestService — the administrative refill-request
 * state machine (CLAUDE.md §2: no dose/interaction judgment anywhere here).
 */

import { RefillRequestService } from "./refill-request.service";
import { PatientScopeService } from "../patient/patient-scope.service";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Pool, QueryResult } from "pg";

const mockScopeService = {
  assertPatientInScope: jest.fn(),
} as unknown as PatientScopeService;

function makeMockPool(rows: Record<string, unknown[]>): Pool {
  return {
    query: jest.fn((sql: string) => {
      for (const [key, value] of Object.entries(rows)) {
        if (sql.includes(key)) {
          return Promise.resolve({ rows: value } as QueryResult);
        }
      }
      return Promise.resolve({ rows: [] } as unknown as QueryResult);
    }),
  } as unknown as Pool;
}

const USER_ID = "user-001";
const OTHER_USER_ID = "user-002";
const PATIENT_ID = "patient-001";

beforeEach(() => {
  jest.clearAllMocks();
  (mockScopeService.assertPatientInScope as jest.Mock).mockResolvedValue(undefined);
});

describe("RefillRequestService.create", () => {
  it("rejects when the medication is not active/documented for this patient", async () => {
    const pool = makeMockPool({ "FROM hospital.medication_request": [] });
    const svc = new RefillRequestService(pool, mockScopeService);
    await expect(svc.create(USER_ID, PATIENT_ID, "med-1")).rejects.toThrow(BadRequestException);
  });

  it("creates a requested-status row snapshotting the medication display", async () => {
    const pool = makeMockPool({
      "FROM hospital.medication_request": [{ medication_display: "Metformin 500mg" }],
      "INSERT INTO app.refill_request": [
        {
          id: "refill-1",
          patient_id: PATIENT_ID,
          medication_request_id: "med-1",
          medication_display: "Metformin 500mg",
          status: "requested",
          requested_by: USER_ID,
          requested_at: "2026-07-10T00:00:00Z",
          pharmacy_note: null,
          updated_at: "2026-07-10T00:00:00Z",
        },
      ],
    });
    const svc = new RefillRequestService(pool, mockScopeService);
    const result = await svc.create(USER_ID, PATIENT_ID, "med-1");
    expect(result.status).toBe("requested");
    expect(result.medication_display).toBe("Metformin 500mg");
  });
});

describe("RefillRequestService.cancel", () => {
  function makePoolWithExisting(status: string, requestedBy: string) {
    return makeMockPool({
      "FROM app.refill_request WHERE id": [
        {
          id: "refill-1",
          patient_id: PATIENT_ID,
          medication_request_id: "med-1",
          medication_display: "Metformin 500mg",
          status,
          requested_by: requestedBy,
          requested_at: "2026-07-10T00:00:00Z",
          pharmacy_note: null,
          updated_at: "2026-07-10T00:00:00Z",
        },
      ],
      "UPDATE app.refill_request": [
        {
          id: "refill-1",
          patient_id: PATIENT_ID,
          medication_request_id: "med-1",
          medication_display: "Metformin 500mg",
          status: "cancelled",
          requested_by: requestedBy,
          requested_at: "2026-07-10T00:00:00Z",
          pharmacy_note: null,
          updated_at: "2026-07-10T00:01:00Z",
        },
      ],
    });
  }

  it("succeeds for the original requester while still 'requested'", async () => {
    const pool = makePoolWithExisting("requested", USER_ID);
    const svc = new RefillRequestService(pool, mockScopeService);
    const result = await svc.cancel(USER_ID, "refill-1");
    expect(result.status).toBe("cancelled");
  });

  it("rejects a different user cancelling someone else's request", async () => {
    const pool = makePoolWithExisting("requested", OTHER_USER_ID);
    const svc = new RefillRequestService(pool, mockScopeService);
    await expect(svc.cancel(USER_ID, "refill-1")).rejects.toThrow(ForbiddenException);
  });

  it("rejects cancelling a request that is no longer 'requested'", async () => {
    const pool = makePoolWithExisting("routed", USER_ID);
    const svc = new RefillRequestService(pool, mockScopeService);
    await expect(svc.cancel(USER_ID, "refill-1")).rejects.toThrow(BadRequestException);
  });

  it("404s on an unknown refill request id", async () => {
    const pool = makeMockPool({});
    const svc = new RefillRequestService(pool, mockScopeService);
    await expect(svc.cancel(USER_ID, "does-not-exist")).rejects.toThrow(NotFoundException);
  });
});

describe("RefillRequestService.updateStatus", () => {
  function makePoolWithExisting(status: string) {
    return makeMockPool({
      "FROM app.refill_request WHERE id": [
        {
          id: "refill-1",
          patient_id: PATIENT_ID,
          medication_request_id: "med-1",
          medication_display: "Metformin 500mg",
          status,
          requested_by: USER_ID,
          requested_at: "2026-07-10T00:00:00Z",
          pharmacy_note: null,
          updated_at: "2026-07-10T00:00:00Z",
        },
      ],
      "UPDATE app.refill_request": [
        {
          id: "refill-1",
          patient_id: PATIENT_ID,
          medication_request_id: "med-1",
          medication_display: "Metformin 500mg",
          status: "routed",
          requested_by: USER_ID,
          requested_at: "2026-07-10T00:00:00Z",
          pharmacy_note: null,
          updated_at: "2026-07-10T00:01:00Z",
        },
      ],
    });
  }

  it("allows requested -> routed", async () => {
    const pool = makePoolWithExisting("requested");
    const svc = new RefillRequestService(pool, mockScopeService);
    const result = await svc.updateStatus("pharmacist-1", "refill-1", "routed");
    expect(result.status).toBe("routed");
  });

  it("rejects requested -> filled (skipping routed)", async () => {
    const pool = makePoolWithExisting("requested");
    const svc = new RefillRequestService(pool, mockScopeService);
    await expect(svc.updateStatus("pharmacist-1", "refill-1", "filled")).rejects.toThrow(BadRequestException);
  });

  it("rejects acting on an already-terminal request (filled -> anything)", async () => {
    const pool = makePoolWithExisting("filled");
    const svc = new RefillRequestService(pool, mockScopeService);
    await expect(svc.updateStatus("pharmacist-1", "refill-1", "routed")).rejects.toThrow(BadRequestException);
  });
});

describe("RefillRequestService.queue", () => {
  it("returns only administrative fields — identity, medication name, status, timestamps", async () => {
    const pool = makeMockPool({
      "FROM app.refill_request r": [
        {
          id: "refill-1",
          patient_id: PATIENT_ID,
          medication_request_id: "med-1",
          medication_display: "Metformin 500mg",
          status: "requested",
          requested_by: USER_ID,
          requested_at: "2026-07-10T00:00:00Z",
          pharmacy_note: null,
          updated_at: "2026-07-10T00:00:00Z",
          patient_mrn: "MRN-010",
          patient_display_name: "Test Patient",
        },
      ],
    });
    const svc = new RefillRequestService(pool, mockScopeService);
    const result = await svc.queue();
    expect(result).toHaveLength(1);
    const keys = Object.keys(result[0]!).sort();
    // No diagnosis/lab/clinical fields anywhere in the shape.
    expect(keys).toEqual(
      [
        "id", "patient_id", "medication_request_id", "medication_display", "status",
        "requested_by", "requested_at", "pharmacy_note", "updated_at",
        "patient_mrn", "patient_display_name",
      ].sort(),
    );
  });
});
