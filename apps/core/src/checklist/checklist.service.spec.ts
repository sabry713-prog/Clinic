/**
 * The checklist stores the clinician's DECISIONS and nothing else.
 *
 * Everything derivable — which entries are suggested, which ticks follow from the note — is computed
 * on the client, so that a stored value can never disagree with the note it was derived from. These
 * tests pin the two things that are not derivable: a tick the derivation did not catch, and a
 * dismissal, which is scoped to the encounter rather than to the patient forever.
 */
import { BadRequestException } from "@nestjs/common";
import { ChecklistService } from "./checklist.service";
import type { PatientScopeService } from "../patient/patient-scope.service";

function makePool() {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  return { query } as unknown as import("pg").Pool;
}

function makeScope(): PatientScopeService {
  return { assertPatientInScope: jest.fn().mockResolvedValue(undefined) } as unknown as PatientScopeService;
}

describe("ChecklistService", () => {
  it("returns the decisions for one encounter, scoped to the caller's patients", async () => {
    const pool = makePool();
    (pool.query as jest.Mock).mockResolvedValue({
      rows: [{ item_id: "vitals", state: "done" }],
    });
    const scope = makeScope();
    const service = new ChecklistService(pool, scope);

    const out = await service.list("user-1", "patient-1", "enc-1");

    expect(scope.assertPatientInScope).toHaveBeenCalledWith("user-1", "patient-1");
    expect(out).toEqual([{ item_id: "vitals", state: "done" }]);
    const [sql, params] = (pool.query as jest.Mock).mock.calls[0]!;
    expect(sql).toContain("app.encounter_checklist");
    expect(params).toEqual(["patient-1", "enc-1"]);
  });

  it("upserts a decision, so ticking twice does not create two rows", async () => {
    const pool = makePool();
    const service = new ChecklistService(pool, makeScope());

    await service.set("user-1", "patient-1", "enc-1", "ecg", "done");

    const [sql, params] = (pool.query as jest.Mock).mock.calls[0]!;
    expect(sql).toContain("ON CONFLICT (encounter_id, item_id)");
    // the sixth slot is the label: a catalog row carries none (see ChecklistService.set)
    expect(params).toEqual(["patient-1", "enc-1", "ecg", "done", "user-1", null]);
  });

  it("stores the text of a row the clinician typed, so it survives the next page load", async () => {
    const pool = makePool();
    const service = new ChecklistService(pool, makeScope());

    await service.set("user-1", "patient-1", "enc-1", "phys-abc", "done", "  Check stool sample  ");

    const [sql, params] = (pool.query as jest.Mock).mock.calls[0]!;
    expect(sql).toContain("label");
    expect(params[5]).toBe("Check stool sample"); // trimmed: leading space is not content
  });

  it("clears a decision by deleting the row — absence is the cleared state", async () => {
    const pool = makePool();
    const service = new ChecklistService(pool, makeScope());

    await service.set("user-1", "patient-1", "enc-1", "ecg", null);

    const [sql] = (pool.query as jest.Mock).mock.calls[0]!;
    expect(sql).toContain("DELETE FROM app.encounter_checklist");
  });

  it("refuses an empty item id rather than writing a row nothing can key on", async () => {
    const service = new ChecklistService(makePool(), makeScope());
    await expect(service.set("user-1", "patient-1", "enc-1", "   ", "done")).rejects.toThrow(
      BadRequestException,
    );
  });
});
