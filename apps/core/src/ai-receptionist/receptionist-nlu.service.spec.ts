/**
 * Unit tests for ReceptionistNluService — proves the catalog-only matching
 * discipline (CLAUDE.md §2): department names match, symptom descriptions
 * never do, and ambiguity is surfaced rather than guessed.
 */
import { ReceptionistNluService } from "./receptionist-nlu.service";

describe("ReceptionistNluService.match", () => {
  const svc = new ReceptionistNluService();

  it("confidently matches a single explicit department and appointment type", () => {
    const result = svc.match("I'd like a follow-up with Cardiology");
    expect(result.departmentDisplay).toBe("Cardiology");
    expect(result.appointmentType).toBe("follow_up");
    expect(result.confident).toBe(true);
  });

  it("is not confident when the text names more than one competing department", () => {
    const result = svc.match("book me with Cardiology or Dermatology");
    expect(result.departmentDisplay).toBeNull();
    expect(result.confident).toBe(false);
  });

  it("never matches a department from symptom text (proves no symptom->department dictionary exists)", () => {
    const result = svc.match("my chest hurts and I feel dizzy");
    expect(result.departmentDisplay).toBeNull();
  });

  it("returns no department for unrelated free text without being 'not confident'", () => {
    const result = svc.match("what time do you open");
    expect(result.departmentDisplay).toBeNull();
    expect(result.confident).toBe(true);
  });
});
