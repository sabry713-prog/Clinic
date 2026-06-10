import { mapPatient, mapEncounter, mapObservation } from "./fhir-mapper";
import type { FhirPatient, FhirEncounter, FhirObservation } from "@clinical-copilot/fhir-client";

describe("fhir-mapper", () => {
  describe("mapPatient", () => {
    const fhirPatient: FhirPatient = {
      resourceType: "Patient",
      id: "patient-001",
      identifier: [
        {
          type: { coding: [{ code: "MR" }] },
          value: "MRN-001",
        },
        {
          type: { coding: [{ code: "NI" }] },
          value: "1234567890",
        },
      ],
      name: [
        {
          use: "official",
          family: "Al-Otaibi",
          given: ["Faris", "Mohammed"],
        },
      ],
      gender: "male",
      birthDate: "1975-03-15",
      communication: [
        {
          language: { coding: [{ code: "ar" }] },
          preferred: true,
        },
      ],
    };

    it("maps MRN from identifier type=MR", () => {
      const row = mapPatient(fhirPatient, "hapi");
      expect(row.mrn).toBe("MRN-001");
    });

    it("hashes national ID — never stores raw value", () => {
      const row = mapPatient(fhirPatient, "hapi");
      expect(row.national_id_hash).not.toBe("1234567890");
      expect(row.national_id_hash).toHaveLength(64); // SHA-256 hex
    });

    it("assembles display_name from given + family", () => {
      const row = mapPatient(fhirPatient, "hapi");
      expect(row.display_name).toContain("Faris");
      expect(row.display_name).toContain("Al-Otaibi");
    });

    it("maps preferred_language", () => {
      const row = mapPatient(fhirPatient, "hapi");
      expect(row.preferred_language).toBe("ar");
    });

    it("maps sex and DOB", () => {
      const row = mapPatient(fhirPatient, "hapi");
      expect(row.sex).toBe("male");
      expect(row.date_of_birth).toBe("1975-03-15");
    });

    it("uses name.text when available", () => {
      const withText: FhirPatient = {
        ...fhirPatient,
        name: [{ text: "Faris Al-Otaibi", use: "official" }],
      };
      const row = mapPatient(withText, "hapi");
      expect(row.display_name).toBe("Faris Al-Otaibi");
    });

    it("handles patient with no identifiers gracefully", () => {
      const minimal: FhirPatient = {
        resourceType: "Patient",
        id: "p-min",
      };
      const row = mapPatient(minimal, "hapi");
      expect(row.mrn).toBeNull();
      expect(row.national_id_hash).toBeNull();
    });

    it("same NI value always produces same hash (deterministic)", () => {
      const r1 = mapPatient(fhirPatient, "hapi");
      const r2 = mapPatient(fhirPatient, "hapi");
      expect(r1.national_id_hash).toBe(r2.national_id_hash);
    });
  });

  describe("mapEncounter", () => {
    const fhirEncounter: FhirEncounter = {
      resourceType: "Encounter",
      id: "enc-001",
      status: "in-progress",
      class: { code: "IMP", display: "Inpatient" },
      subject: { reference: "Patient/patient-001" },
      period: { start: "2025-06-01T08:00:00Z" },
      participant: [
        {
          type: [{ coding: [{ code: "ATND" }] }],
          individual: { reference: "Practitioner/prac-001", display: "Dr. Smith" },
        },
      ],
      location: [
        { location: { display: "Ward-4A" } },
      ],
    };

    it("maps encounter type and status", () => {
      const row = mapEncounter(fhirEncounter, "hapi");
      expect(row?.encounter_type).toBe("IMP");
      expect(row?.status).toBe("in-progress");
    });

    it("extracts patient source_id from subject reference", () => {
      const row = mapEncounter(fhirEncounter, "hapi");
      expect(row?.patient_source_id).toBe("patient-001");
    });

    it("extracts ward from location display", () => {
      const row = mapEncounter(fhirEncounter, "hapi");
      expect(row?.ward).toBe("Ward-4A");
    });

    it("returns null when no patient reference", () => {
      const noSubject: FhirEncounter = { ...fhirEncounter, subject: undefined };
      const row = mapEncounter(noSubject, "hapi");
      expect(row).toBeNull();
    });
  });

  describe("mapObservation", () => {
    const fhirObs: FhirObservation = {
      resourceType: "Observation",
      id: "obs-001",
      status: "final",
      category: [{ coding: [{ code: "laboratory" }] }],
      code: { coding: [{ system: "http://loinc.org", code: "2160-0", display: "Creatinine" }] },
      subject: { reference: "Patient/patient-001" },
      effectiveDateTime: "2025-06-01T10:00:00Z",
      valueQuantity: { value: 138, unit: "μmol/L" },
      referenceRange: [
        { low: { value: 59 }, high: { value: 104 }, text: "59-104 μmol/L" },
      ],
    };

    it("maps numeric value and unit", () => {
      const row = mapObservation(fhirObs, "hapi");
      expect(row?.value_numeric).toBe(138);
      expect(row?.unit).toBe("μmol/L");
    });

    it("maps reference range", () => {
      const row = mapObservation(fhirObs, "hapi");
      expect(row?.ref_range_low).toBe(59);
      expect(row?.ref_range_high).toBe(104);
      expect(row?.ref_range_text).toBe("59-104 μmol/L");
    });

    it("maps LOINC code", () => {
      const row = mapObservation(fhirObs, "hapi");
      expect(row?.code).toBe("2160-0");
      expect(row?.code_system).toBe("http://loinc.org");
    });

    it("maps category", () => {
      const row = mapObservation(fhirObs, "hapi");
      expect(row?.category).toBe("laboratory");
    });
  });
});
