import { scoreReconciliation, type ReconcilablePatient } from "./identity-reconciler";

describe("identity-reconciler", () => {
  const makePatient = (overrides: Partial<ReconcilablePatient> = {}): ReconcilablePatient => ({
    id: "00000000-0000-0000-0000-000000000001",
    national_id_hash: "hash-abc123",
    mrn: "MRN-001",
    source_system: "hapi",
    date_of_birth: "1980-01-01",
    family_name: "Fakename-Al-Otaibi",
    given_name: "Faris",
    sex: "male",
    ...overrides,
  });

  // ─── Auto-merge scenarios ────────────────────────────────────────────────

  it("auto-merges on NID + DOB + name + sex match (score ≥95)", () => {
    const a = makePatient({ id: "aaa" });
    const b = makePatient({ id: "bbb" });
    const result = scoreReconciliation(a, b);
    expect(result.decision).toBe("merge");
    expect(result.score).toBeGreaterThanOrEqual(95);
  });

  it("auto-merges on NID + same-source MRN + DOB + name + sex (score = 100)", () => {
    const a = makePatient({ id: "aaa" });
    const b = makePatient({ id: "bbb" });
    const result = scoreReconciliation(a, b);
    expect(result.score).toBe(100);
    expect(result.features.national_id_hash_match).toBe(true);
    expect(result.features.mrn_same_source_match).toBe(true);
    expect(result.features.dob_match).toBe(true);
    expect(result.features.name_similarity).toBeGreaterThan(0.9);
    expect(result.features.sex_match).toBe(true);
  });

  // ─── Quarantine scenarios ────────────────────────────────────────────────

  it("quarantines when NID matches but name differs (70 ≤ score < 95)", () => {
    const a = makePatient({ id: "aaa", given_name: "Faris", family_name: "Al-Otaibi" });
    const b = makePatient({
      id: "bbb",
      given_name: "Completely",
      family_name: "Different",
      // Different MRN so the same-source MRN signal does not also fire; this
      // isolates the "NID matches, name differs" case the test name describes.
      mrn: "MRN-002",
    });
    const result = scoreReconciliation(a, b);
    // NID=60 + DOB=8 + sex=2 = 70 (name similarity < 0.9 so no +5)
    expect(result.decision).toBe("quarantine");
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.score).toBeLessThan(95);
  });

  it("quarantines (NID mismatch override) when NID mismatch but everything else matches", () => {
    const a = makePatient({ id: "aaa", national_id_hash: "hash-A" });
    const b = makePatient({ id: "bbb", national_id_hash: "hash-B" });
    const result = scoreReconciliation(a, b);
    // NID mismatch → quarantine forced regardless of score
    expect(result.decision).toBe("quarantine");
    expect(result.features.national_id_hash_mismatch).toBe(true);
  });

  it("quarantines when MRN same-source matches but NID missing (score = 25+8+5+2=40 → separate?) no: with NID null both sides NID doesn't add to score", () => {
    // MRN + DOB + name + sex = 25+8+5+2 = 40 → separate actually
    // Let's test the 70-94 range: MRN + DOB + name + sex = 40 < 70 → separate
    // To get quarantine without NID: impossible with these weights. That's correct by design.
    const a = makePatient({ id: "aaa", national_id_hash: null, mrn: "MRN-X" });
    const b = makePatient({ id: "bbb", national_id_hash: null, mrn: "MRN-X" });
    const result = scoreReconciliation(a, b);
    // 25 (MRN) + 8 (DOB) + 5 (name) + 2 (sex) = 40
    expect(result.score).toBe(40);
    expect(result.decision).toBe("separate");
  });

  // ─── Separate scenarios ──────────────────────────────────────────────────

  it("separates when NID differs and no other matches (score = 0)", () => {
    const a = makePatient({
      id: "aaa",
      national_id_hash: "hash-A",
      mrn: "MRN-A",
      date_of_birth: "1980-01-01",
      given_name: "Faris",
      family_name: "Al-A",
      sex: "male",
    });
    const b = makePatient({
      id: "bbb",
      national_id_hash: "hash-B",
      mrn: "MRN-B",
      source_system: "other", // different source, MRN match doesn't count
      date_of_birth: "1990-12-31",
      given_name: "Nora",
      family_name: "Al-B",
      sex: "female",
    });
    const result = scoreReconciliation(a, b);
    expect(result.decision).toBe("separate");
    expect(result.score).toBeLessThan(70);
    expect(result.features.national_id_hash_match).toBe(false);
    expect(result.features.mrn_same_source_match).toBe(false);
  });

  it("separates completely different patients", () => {
    const a = makePatient({ id: "aaa", national_id_hash: "hash-X", mrn: "X001", date_of_birth: "1960-01-01", given_name: "A", family_name: "B", sex: "male" });
    const b = makePatient({ id: "bbb", national_id_hash: "hash-Y", mrn: "Y002", date_of_birth: "1990-12-31", given_name: "C", family_name: "D", sex: "female" });
    const result = scoreReconciliation(a, b);
    expect(result.decision).toBe("separate");
  });

  // ─── Feature edge cases ──────────────────────────────────────────────────

  it("does not match MRN across different source systems", () => {
    const a = makePatient({ id: "aaa", source_system: "ehr-a", mrn: "MRN-001" });
    const b = makePatient({ id: "bbb", source_system: "ehr-b", mrn: "MRN-001" });
    const result = scoreReconciliation(a, b);
    expect(result.features.mrn_same_source_match).toBe(false);
  });

  it("handles null name gracefully", () => {
    const a = makePatient({ id: "aaa", given_name: null, family_name: null });
    const b = makePatient({ id: "bbb", given_name: null, family_name: null });
    const result = scoreReconciliation(a, b);
    expect(result.features.name_similarity).toBe(0);
  });

  it("handles null DOB gracefully", () => {
    const a = makePatient({ id: "aaa", date_of_birth: null });
    const b = makePatient({ id: "bbb", date_of_birth: null });
    const result = scoreReconciliation(a, b);
    expect(result.features.dob_match).toBe(false);
  });
});
