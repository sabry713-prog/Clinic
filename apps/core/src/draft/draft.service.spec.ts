/**
 * DraftService specialty-template tests.
 *
 * Verifies:
 * - "general" specialty produces byte-identical section titles to the base
 *   template (no regression to existing default behavior).
 * - A specialty override changes ONLY the section title, never the assembled
 *   facts content (same SQL, same data).
 * - Non-general specialties insert an Allergies section right after Identity.
 * - Arabic title lookup resolves for both generic and specialty-overridden titles.
 */
import { DraftService } from "./draft.service";
import type { PatientScopeService } from "../patient/patient-scope.service";

function makePool(overrides: Record<string, unknown[]> = {}) {
  const query = jest.fn().mockImplementation((sql: string, params?: unknown[]) => {
    if (typeof sql === "string" && sql.includes("FROM hospital.patient")) {
      return Promise.resolve({ rows: overrides["identity"] ?? [{ display_name: "Test Patient", mrn: "MRN-1", date_of_birth: "1980-01-01", sex: "male" }] });
    }
    if (typeof sql === "string" && sql.includes("FROM hospital.condition")) {
      return Promise.resolve({ rows: overrides["problems"] ?? [{ code_display: "Type 2 diabetes", status: "active", onset_date: "2020-01-01" }] });
    }
    if (typeof sql === "string" && sql.includes("FROM hospital.medication_request")) {
      return Promise.resolve({ rows: overrides["medications"] ?? [{ medication_display: "Metformin", dose: "500mg", route: "oral", frequency: "BID" }] });
    }
    if (typeof sql === "string" && sql.includes("FROM hospital.observation")) {
      return Promise.resolve({ rows: overrides["results"] ?? [] });
    }
    if (typeof sql === "string" && sql.includes("FROM hospital.allergy_intolerance")) {
      return Promise.resolve({ rows: overrides["allergies"] ?? [{ code_display: "Penicillin", reaction: "Rash", recorded_at: "2021-01-01" }] });
    }
    if (typeof sql === "string" && sql.includes("FROM hospital.document_reference")) {
      return Promise.resolve({ rows: [] });
    }
    if (typeof sql === "string" && sql.includes("INSERT INTO app.document_draft")) {
      // Echo back the sections_json param (index 4), mirroring Postgres's
      // automatic jsonb column parsing on RETURNING.
      const sectionsJson = JSON.parse((params?.[4] as string) ?? "[]") as unknown[];
      return Promise.resolve({ rows: [{ id: "draft-1", sections_json: sectionsJson }] });
    }
    return Promise.resolve({ rows: [] });
  });
  return { query } as unknown as import("pg").Pool;
}

function makeScope(): PatientScopeService {
  return { assertPatientInScope: jest.fn().mockResolvedValue(undefined) } as unknown as PatientScopeService;
}

describe("DraftService specialty templates", () => {
  it("general specialty keeps the base template titles unchanged", async () => {
    const service = new DraftService(makePool(), makeScope());
    const draft = await service.generate("user-1", "patient-1", "discharge_summary", "en", "general");
    const sections = draft.sections_json as unknown as Array<{ key: string; title: string }>;
    expect(sections.map((s) => s.key)).toEqual(["identity", "problems", "medications", "results", "assessment", "plan"]);
    expect(sections.find((s) => s.key === "problems")?.title).toBe("Documented Problems");
  });

  it("cardiology specialty overrides problem/medication/results titles only", async () => {
    const service = new DraftService(makePool(), makeScope());
    const draft = await service.generate("user-1", "patient-1", "discharge_summary", "en", "cardiology");
    const sections = draft.sections_json as unknown as Array<{ key: string; title: string; text: string }>;
    expect(sections.find((s) => s.key === "problems")?.title).toBe("Cardiac Problem List");
    expect(sections.find((s) => s.key === "medications")?.title).toBe("Cardiac Medications");
    expect(sections.find((s) => s.key === "results")?.title).toBe("Cardiac & Laboratory Results");
    // Same underlying fact, unchanged by the specialty override.
    expect(sections.find((s) => s.key === "problems")?.text).toContain("Type 2 diabetes");
  });

  it("non-general specialty inserts an Allergies section right after Identity", async () => {
    const service = new DraftService(makePool(), makeScope());
    const draft = await service.generate("user-1", "patient-1", "discharge_summary", "en", "orthopedics");
    const sections = draft.sections_json as unknown as Array<{ key: string; title: string; text: string }>;
    const identityIdx = sections.findIndex((s) => s.key === "identity");
    expect(sections[identityIdx + 1]?.key).toBe("allergies");
    expect(sections.find((s) => s.key === "allergies")?.text).toContain("Penicillin");
  });

  it("general specialty does not insert an Allergies section", async () => {
    const service = new DraftService(makePool(), makeScope());
    const draft = await service.generate("user-1", "patient-1", "discharge_summary", "en", "general");
    const sections = draft.sections_json as unknown as Array<{ key: string }>;
    expect(sections.some((s) => s.key === "allergies")).toBe(false);
  });

  it("resolves Arabic titles for both generic and specialty-overridden sections", async () => {
    const service = new DraftService(makePool(), makeScope());
    const draft = await service.generate("user-1", "patient-1", "discharge_summary", "ar", "cardiology");
    const sections = draft.sections_json as unknown as Array<{ key: string; title: string }>;
    expect(sections.find((s) => s.key === "problems")?.title).toBe("قائمة المشاكل القلبية");
    expect(sections.find((s) => s.key === "allergies")?.title).toBe("الحساسيات");
  });
});
