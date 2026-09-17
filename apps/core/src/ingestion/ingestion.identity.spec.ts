/**
 * M05 — the two things the ingestion path was dropping.
 *
 * 1. `attending_fhir_ref`: mapEncounter has always produced it and the upsert never
 *    wrote it (no such column), so "who saw this patient" had no answer.
 * 2. A confident identity duplicate ("merge") was written to the log and forgotten,
 *    while the less certain "quarantine" case was recorded for review.
 *
 * Both assertions are deliberately on the SQL and on the recorded rows, not on a
 * green path: a mapper that extracts a field and an upsert that ignores it read
 * identically from the outside.
 */
import { ConfigService } from "@nestjs/config";
import type { Pool } from "pg";

jest.mock("@clinical-copilot/audit", () => ({
  writeAuditEvent: jest.fn().mockResolvedValue({ id: "event-1", hash_self: "hash-1" }),
}));

// The scorer is pulled in by the service; its own spec covers the arithmetic.
jest.mock("./identity-reconciler", () => ({
  ...jest.requireActual<object>("./identity-reconciler"),
  scoreReconciliation: jest.fn(),
}));

import { writeAuditEvent } from "@clinical-copilot/audit";
import { IngestionService } from "./ingestion.service";
import { scoreReconciliation } from "./identity-reconciler";

const auditWrite = writeAuditEvent as jest.Mock;
const scorer = scoreReconciliation as unknown as jest.Mock;

function makeService(pool: { query: jest.Mock; connect?: jest.Mock }): IngestionService {
  const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
  return new IngestionService(pool as unknown as Pool, config);
}

describe("M05 — ingestion keeps what the source sent", () => {
  beforeEach(() => {
    auditWrite.mockClear();
    scorer.mockReset();
  });

  it("writes the attending clinician reference into hospital.encounter", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: jest.fn((sql: string, params: unknown[]) => {
        statements.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };
    const service = makeService({ query: jest.fn(), connect: jest.fn().mockResolvedValue(client) });

    await service["upsertRelatedResources"]("patient-1", {
      encounters: [
        {
          source_system: "hapi",
          source_id: "enc-1",
          encounter_type: "AMB",
          status: "finished",
          started_at: null,
          ended_at: null,
          ward: null,
          bed: null,
          attending_fhir_ref: "Practitioner/1234",
          fhir_resource_json: {},
        },
      ],
      observations: [],
      allergies: [],
      conditions: [],
      medications: [],
      documents: [],
      partial_failures: [],
    } as never);

    const insert = statements.find((s) => s.sql.includes("INSERT INTO hospital.encounter"));
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain("attending_fhir_ref");
    // and the value travels, rather than the column being named and left null
    expect(insert!.params).toContain("Practitioner/1234");
  });

  it("records a confident duplicate for review instead of only logging it", async () => {
    scorer.mockReturnValue({
      decision: "merge",
      score: 95,
      features: { national_id_hash: "same", mrn: "same" },
    });

    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const query = jest.fn((sql: string, params: unknown[]) => {
      statements.push({ sql: sql.replace(/\s+/g, " ").trim(), params: params ?? [] });
      if (sql.includes("SELECT id FROM hospital.patient")) {
        return Promise.resolve({ rows: [{ id: "cand-1" }] });
      }
      if (sql.includes("SELECT id FROM app.identity_quarantine")) {
        return Promise.resolve({ rows: [] }); // nothing recorded for this pair yet
      }
      if (sql.includes("FROM hospital.patient") && sql.includes("$1")) {
        return Promise.resolve({
          rows: [
            {
              id: "cand-1",
              national_id_hash: "same",
              mrn: "MRN-006",
              source_system: "hapi",
              date_of_birth: "1980-01-01",
              family_name: "A",
              given_name: "B",
              sex: "male",
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const service = makeService({ query });

    await service["reconcileIdentity"](
      "patient-1",
      {
        national_id_hash: "same",
        mrn: "MRN-006",
        source_system: "hapi",
        date_of_birth: "1980-01-01",
        family_name: "A",
        given_name: "B",
        sex: "male",
      } as never,
      "req-1" as never,
    );

    const inserted = statements.find((s) => s.sql.includes("INSERT INTO app.identity_quarantine"));
    expect(inserted).toBeDefined();
    const features = JSON.parse(String(inserted!.params[4])) as Record<string, unknown>;
    // the decision travels with the row, so the review queue can tell a confident
    // duplicate from an uncertain one
    expect(features.decision).toBe("merge");

    expect(auditWrite).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "IDENTITY_MERGE_CANDIDATE_RECORDED" }),
    );
  });

  it("does not record the same pair twice", async () => {
    scorer.mockReturnValue({ decision: "merge", score: 95, features: {} });

    const statements: string[] = [];
    const query = jest.fn((sql: string) => {
      statements.push(sql.replace(/\s+/g, " ").trim());
      if (sql.includes("SELECT id FROM hospital.patient")) return Promise.resolve({ rows: [{ id: "cand-1" }] });
      if (sql.includes("SELECT id FROM app.identity_quarantine")) return Promise.resolve({ rows: [{ id: "existing" }] });
      if (sql.includes("FROM hospital.patient") && sql.includes("$1")) {
        return Promise.resolve({
          rows: [{ id: "cand-1", national_id_hash: "same", mrn: "MRN-006", source_system: "hapi", date_of_birth: null, family_name: null, given_name: null, sex: null }],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const service = makeService({ query });

    await service["reconcileIdentity"]("patient-1", { national_id_hash: "same" } as never, "req-1" as never);

    expect(statements.filter((s) => s.includes("INSERT INTO app.identity_quarantine"))).toHaveLength(0);
    expect(auditWrite).not.toHaveBeenCalled();
  });
});
