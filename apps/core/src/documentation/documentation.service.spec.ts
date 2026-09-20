/**
 * How the note was captured — and the one fact the product was missing: a patient may decline to be
 * recorded, and the record should say so rather than leaving a note with no transcript behind it and
 * no explanation.
 */
import { BadRequestException } from "@nestjs/common";
import { DocumentationService } from "./documentation.service";
import type { PatientScopeService } from "../patient/patient-scope.service";

function makePool() {
  return { query: jest.fn().mockResolvedValue({ rows: [] }) } as unknown as import("pg").Pool;
}
function makeScope(): PatientScopeService {
  return { assertPatientInScope: jest.fn().mockResolvedValue(undefined) } as unknown as PatientScopeService;
}

describe("DocumentationService", () => {
  it("returns null for an encounter nothing was recorded against, rather than guessing a source", async () => {
    const service = new DocumentationService(makePool(), makeScope());
    expect(await service.get("user-1", "patient-1", "enc-1")).toBeNull();
  });

  it("records the mechanism and the refusal as separate facts", async () => {
    const pool = makePool();
    (pool.query as jest.Mock).mockResolvedValue({
      rows: [{ source: "manual", recording_declined: true }],
    });
    const service = new DocumentationService(pool, makeScope());

    const out = await service.set("user-1", "patient-1", "enc-1", "manual", true);

    expect(out).toEqual({ source: "manual", recording_declined: true });
    const [sql, params] = (pool.query as jest.Mock).mock.calls[0]!;
    expect(sql).toContain("ON CONFLICT (encounter_id)");
    expect(params).toEqual(["enc-1", "patient-1", "manual", true, "user-1"]);
  });

  it("refuses an encounter-less write", async () => {
    const service = new DocumentationService(makePool(), makeScope());
    await expect(service.set("user-1", "patient-1", "", "ambient", false)).rejects.toThrow(BadRequestException);
  });
});
