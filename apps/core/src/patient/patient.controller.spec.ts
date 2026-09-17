import type { Pool } from "pg";
import type { Request } from "express";

jest.mock("@clinical-copilot/audit", () => ({
  writeAuditEvent: jest.fn().mockResolvedValue({ id: "event-1", hash_self: "hash-1" }),
}));

import { writeAuditEvent } from "@clinical-copilot/audit";
import { PatientController } from "./patient.controller";
import type { PatientService } from "./patient.service";
import type { PatientScopeService } from "./patient-scope.service";

const auditWrite = writeAuditEvent as jest.Mock;

function makeController(
  searchResult: unknown = { total: 0, results: [] },
): PatientController {
  const patientService = {
    searchRecord: jest.fn().mockResolvedValue(searchResult),
  } as unknown as PatientService;
  const scopeService = {} as unknown as PatientScopeService;
  const pool = {} as Pool;
  return new PatientController(patientService, scopeService, pool);
}

function makeReq(): Request {
  return {
    authenticatedUserId: "11111111-1111-1111-1111-111111111111",
    authenticatedUserRole: "physician",
    requestId: "req-1",
  } as unknown as Request;
}

describe("PatientController.searchRecord", () => {
  beforeEach(() => {
    auditWrite.mockClear();
  });

  // M08 / register item 5: "scrub raw search metadata". The audit trail must
  // record that a search happened without storing what was searched for -- the
  // query text can carry identifiers, and the audit log is retained and exported.
  it("audits a search without the raw query text", async () => {
    const controller = makeController();

    await controller.searchRecord(makeReq(), "patient-1", "sara al-anazi national id 1234567890");

    expect(auditWrite).toHaveBeenCalledTimes(1);
    const payload = auditWrite.mock.calls[0][1] as { metadata_json: Record<string, unknown> };
    const serialised = JSON.stringify(payload.metadata_json);

    expect(serialised).not.toContain("sara");
    expect(serialised).not.toContain("1234567890");
    expect(serialised).not.toContain("al-anazi");
    // What is recorded instead: a digest, a length, and how much matched.
    expect(payload.metadata_json).toMatchObject({
      query_hash: expect.stringMatching(/^[0-9a-f]{16}$/),
      query_len: "sara al-anazi national id 1234567890".length,
      result_count: 0,
    });
  });

  it("hashes the query so identical searches are correlatable without the text", async () => {
    const controller = makeController();

    await controller.searchRecord(makeReq(), "patient-1", "chest pain");
    await controller.searchRecord(makeReq(), "patient-1", "chest pain");
    await controller.searchRecord(makeReq(), "patient-1", "back pain");

    const hashes = auditWrite.mock.calls.map(
      (c) => (c[1] as { metadata_json: { query_hash: string } }).metadata_json.query_hash,
    );
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[2]).not.toBe(hashes[0]);
  });
});
