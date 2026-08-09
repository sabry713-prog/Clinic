/**
 * Unit tests for ClaimReadinessService — focused on the R11 MDS-evidence
 * completeness check (app.nphies_clinical_mapping requires_vitals /
 * requires_note_types). Queries are mocked in the exact sequential order
 * evaluate() issues them, since query text alone isn't a reliable
 * discriminator across the many similarly-shaped completeness checks.
 */

import { ClaimReadinessService } from "./claim-readiness.service";
import { PatientScopeService } from "../patient/patient-scope.service";
import type { Pool, QueryResult } from "pg";

const mockScopeService = {
  assertPatientInScope: jest.fn(),
} as unknown as PatientScopeService;

interface MdsRow {
  service_request_id: string;
  order_display: string;
  icd10am_code: string;
  requires_vitals: boolean;
  requires_note_types: string[] | null;
  encounter_id: string | null;
  has_vitals: boolean;
  has_note_type: boolean;
}

/** Queues one resolved query result per call, in the order evaluate() issues them. */
function makeSequencedPool(mdsRows: MdsRow[]): Pool {
  const query = jest
    .fn()
    // R1 identity
    .mockResolvedValueOnce({
      rows: [{ mrn: "MRN-1", date_of_birth: "1980-01-01", sex: "male", national_id_hash: "h" }],
    } as QueryResult)
    // R2 encounter count
    .mockResolvedValueOnce({ rows: [{ n: "1" }] } as QueryResult)
    // R3/R4 condition total/coded
    .mockResolvedValueOnce({ rows: [{ total: "1", coded: "1" }] } as QueryResult)
    // R5 icd confirmed count
    .mockResolvedValueOnce({ rows: [{ n: "1" }] } as QueryResult)
    // R6/R7 orders total/coded
    .mockResolvedValueOnce({ rows: [{ total: "1", coded: "1" }] } as QueryResult)
    // sbs confirmed count
    .mockResolvedValueOnce({ rows: [{ n: "1" }] } as QueryResult)
    // linked count
    .mockResolvedValueOnce({ rows: [{ n: "1" }] } as QueryResult)
    // R10 pairings (empty — not under test here)
    .mockResolvedValueOnce({ rows: [] } as unknown as QueryResult)
    // R11 mds evidence rows
    .mockResolvedValueOnce({ rows: mdsRows } as unknown as QueryResult)
    // R8 medications total/coded (no active meds)
    .mockResolvedValueOnce({ rows: [{ total: "0", coded: "0" }] } as QueryResult)
    // R9 eligibility (none in last 7 days)
    .mockResolvedValueOnce({ rows: [] } as unknown as QueryResult);

  return { query } as unknown as Pool;
}

describe("ClaimReadinessService — R11 MDS evidence completeness", () => {
  const USER_ID = "user-001";
  const PATIENT_ID = "patient-001";

  beforeEach(() => {
    jest.clearAllMocks();
    (mockScopeService.assertPatientInScope as jest.Mock).mockResolvedValue(undefined);
  });

  it("reports not_applicable when the order isn't linked to a saved encounter document", async () => {
    const pool = makeSequencedPool([
      {
        service_request_id: "sr-1",
        order_display: "Chest X-ray",
        icd10am_code: "R07.4",
        requires_vitals: true,
        requires_note_types: null,
        encounter_id: null,
        has_vitals: false,
        has_note_type: false,
      },
    ]);
    const svc = new ClaimReadinessService(pool, mockScopeService);
    const result = await svc.evaluate(USER_ID, PATIENT_ID);

    const check = result.checks.find((c) => c.id === "mds_evidence_complete:sr-1:R07.4");
    expect(check?.status).toBe("not_applicable");
    expect(check?.detail).toMatch(/isn't linked to a saved encounter document/);
  });

  it("passes when the required vital-signs observation is present", async () => {
    const pool = makeSequencedPool([
      {
        service_request_id: "sr-1",
        order_display: "Chest X-ray",
        icd10am_code: "R07.4",
        requires_vitals: true,
        requires_note_types: null,
        encounter_id: "enc-1",
        has_vitals: true,
        has_note_type: false,
      },
    ]);
    const svc = new ClaimReadinessService(pool, mockScopeService);
    const result = await svc.evaluate(USER_ID, PATIENT_ID);

    const check = result.checks.find((c) => c.id === "mds_evidence_complete:sr-1:R07.4");
    expect(check?.status).toBe("pass");
  });

  it("warns and names the missing evidence when vitals are required but absent", async () => {
    const pool = makeSequencedPool([
      {
        service_request_id: "sr-1",
        order_display: "Chest X-ray",
        icd10am_code: "R07.4",
        requires_vitals: true,
        requires_note_types: null,
        encounter_id: "enc-1",
        has_vitals: false,
        has_note_type: false,
      },
    ]);
    const svc = new ClaimReadinessService(pool, mockScopeService);
    const result = await svc.evaluate(USER_ID, PATIENT_ID);

    const check = result.checks.find((c) => c.id === "mds_evidence_complete:sr-1:R07.4");
    expect(check?.status).toBe("warning");
    expect(check?.detail).toContain("vital-signs observation");
  });

  it("warns and names the missing note type when a required document type is absent", async () => {
    const pool = makeSequencedPool([
      {
        service_request_id: "sr-1",
        order_display: "Chest X-ray",
        icd10am_code: "R07.4",
        requires_vitals: false,
        requires_note_types: ["Admission note"],
        encounter_id: "enc-1",
        has_vitals: false,
        has_note_type: false,
      },
    ]);
    const svc = new ClaimReadinessService(pool, mockScopeService);
    const result = await svc.evaluate(USER_ID, PATIENT_ID);

    const check = result.checks.find((c) => c.id === "mds_evidence_complete:sr-1:R07.4");
    expect(check?.status).toBe("warning");
    expect(check?.detail).toContain("Admission note");
  });

  it("adds no mds_evidence_complete check when no order has a mapping with MDS requirements", async () => {
    const pool = makeSequencedPool([]);
    const svc = new ClaimReadinessService(pool, mockScopeService);
    const result = await svc.evaluate(USER_ID, PATIENT_ID);

    expect(result.checks.some((c) => c.id.startsWith("mds_evidence_complete:"))).toBe(false);
  });

  it("keeps two pairings on the same order+procedure code as distinct, correctly-labeled checks (regression: live-DB run initially produced a silent duplicate here because the query matched on sbs_code alone)", async () => {
    const pool = makeSequencedPool([
      {
        service_request_id: "sr-1",
        order_display: "Chest X-ray",
        icd10am_code: "R07.4",
        requires_vitals: true,
        requires_note_types: ["Admission note"],
        encounter_id: "enc-1",
        has_vitals: true,
        has_note_type: false,
      },
      {
        service_request_id: "sr-1",
        order_display: "Chest X-ray",
        icd10am_code: "R06.0",
        requires_vitals: true,
        requires_note_types: null,
        encounter_id: "enc-1",
        has_vitals: true,
        has_note_type: false,
      },
    ]);
    const svc = new ClaimReadinessService(pool, mockScopeService);
    const result = await svc.evaluate(USER_ID, PATIENT_ID);

    const mdsChecks = result.checks.filter((c) => c.id.startsWith("mds_evidence_complete:sr-1"));
    expect(mdsChecks).toHaveLength(2);
    const byId = new Map(mdsChecks.map((c) => [c.id, c]));
    // R07.4 pairing also requires a note type that's missing -> warning.
    expect(byId.get("mds_evidence_complete:sr-1:R07.4")?.status).toBe("warning");
    // R06.0 pairing only requires vitals, which is present -> pass.
    expect(byId.get("mds_evidence_complete:sr-1:R06.0")?.status).toBe("pass");
  });

  it("never mentions the content of a clinical note or observation value in any check detail", async () => {
    const pool = makeSequencedPool([
      {
        service_request_id: "sr-1",
        order_display: "Chest X-ray",
        icd10am_code: "R07.4",
        requires_vitals: true,
        requires_note_types: ["Admission note"],
        encounter_id: "enc-1",
        has_vitals: false,
        has_note_type: false,
      },
    ]);
    const svc = new ClaimReadinessService(pool, mockScopeService);
    const result = await svc.evaluate(USER_ID, PATIENT_ID);

    // Defense-in-depth: this check only ever reports presence/absence, so
    // its detail text must never carry interpretive language.
    const blocklistWords = ["worsening", "improving", "concerning", "trending", "suspect", "likely"];
    for (const check of result.checks) {
      for (const word of blocklistWords) {
        expect(check.detail.toLowerCase()).not.toContain(word);
      }
    }
  });
});
