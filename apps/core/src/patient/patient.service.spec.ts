/**
 * Unit tests for PatientService — list and detail operations.
 */

import { PatientService } from "./patient.service";
import { PatientScopeService } from "./patient-scope.service";
import { NotFoundException } from "@nestjs/common";
import type { Pool, QueryResult } from "pg";

// Mock scope service
const mockScopeService = {
  getScopedPatientIds: jest.fn(),
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

describe("PatientService", () => {
  const USER_ID = "user-001";

  beforeEach(() => {
    jest.clearAllMocks();
    (mockScopeService.assertPatientInScope as jest.Mock).mockResolvedValue(undefined);
  });

  describe("listPatients", () => {
    it("returns empty page when scope is empty", async () => {
      (mockScopeService.getScopedPatientIds as jest.Mock).mockResolvedValue(new Set());

      const svc = new PatientService(
        {} as Pool,
        mockScopeService,
      );

      const result = await svc.listPatients(USER_ID, {});
      expect(result.data).toHaveLength(0);
      expect(result.next_cursor).toBeNull();
    });

    it("queries DB with scoped patient IDs", async () => {
      (mockScopeService.getScopedPatientIds as jest.Mock).mockResolvedValue(
        new Set(["pid-001", "pid-002"]),
      );

      const fakePatient = {
        id: "pid-001",
        mrn: "MRN-001",
        display_name: "Faris Fakename",
        date_of_birth: "1975-03-15",
        sex: "male",
        preferred_language: "ar",
        ward: "Ward-4A",
      };

      const pool = makeMockPool({
        "hospital.patient": [fakePatient],
      });

      const svc = new PatientService(pool, mockScopeService);
      const result = await svc.listPatients(USER_ID, {});

      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.display_name).toBe("Faris Fakename");
    });

    it("cursor pagination: sets next_cursor when more results exist", async () => {
      (mockScopeService.getScopedPatientIds as jest.Mock).mockResolvedValue(
        new Set(["pid-001"]),
      );

      // Return limit+1 rows to trigger cursor generation
      const fakePatients = Array.from({ length: 21 }, (_, i) => ({
        id: `pid-${i.toString().padStart(3, "0")}`,
        mrn: `MRN-${i}`,
        display_name: `Patient ${i}`,
        date_of_birth: null,
        sex: null,
        preferred_language: null,
        ward: null,
      }));

      const pool = makeMockPool({ "hospital.patient": fakePatients });
      const svc = new PatientService(pool, mockScopeService);
      const result = await svc.listPatients(USER_ID, { limit: 20 });

      expect(result.data).toHaveLength(20);
      expect(result.next_cursor).not.toBeNull();
    });
  });

  describe("getPatient", () => {
    it("throws NotFoundException when patient not found", async () => {
      const pool = makeMockPool({ "hospital.patient": [] });
      const svc = new PatientService(pool, mockScopeService);

      await expect(svc.getPatient(USER_ID, "nonexistent-id")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns patient detail with allergies and conditions", async () => {
      const fakePatient = {
        id: "pid-001",
        mrn: "MRN-001",
        display_name: "Test Patient",
        date_of_birth: "1975-03-15",
        sex: "male",
        preferred_language: "ar",
        ward: null,
      };

      const fakeAllergy = {
        id: "allergy-001",
        code: "7980",
        code_display: "Penicillin",
        reaction: "Rash",
        recorded_at: "2023-01-01",
      };

      let callCount = 0;
      const pool = {
        query: jest.fn((sql: string) => {
          if (sql.includes("hospital.patient") && callCount === 0) {
            callCount++;
            return Promise.resolve({ rows: [fakePatient] } as QueryResult);
          }
          if (sql.includes("allergy_intolerance")) {
            return Promise.resolve({ rows: [fakeAllergy] } as QueryResult);
          }
          if (sql.includes("condition")) {
            return Promise.resolve({ rows: [] } as unknown as QueryResult);
          }
          return Promise.resolve({ rows: [] } as unknown as QueryResult);
        }),
      } as unknown as Pool;

      const svc = new PatientService(pool, mockScopeService);
      const result = await svc.getPatient(USER_ID, "pid-001");

      expect(result.display_name).toBe("Test Patient");
      expect(result.allergies).toHaveLength(1);
      expect(result.allergies[0]?.code_display).toBe("Penicillin");
    });
  });

  describe("listObservations", () => {
    it("returns observations filtered by code", async () => {
      const fakeObs = {
        id: "obs-001",
        category: "laboratory",
        code: "2160-0",
        code_display: "Creatinine",
        value_numeric: 138,
        value_text: null,
        unit: "μmol/L",
        ref_range_low: 59,
        ref_range_high: 104,
        ref_range_text: null,
        effective_at: "2025-06-01T10:00:00Z",
      };

      const pool = makeMockPool({ observation: [fakeObs] });
      const svc = new PatientService(pool, mockScopeService);
      const result = await svc.listObservations(USER_ID, "pid-001", { code: "2160-0" });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.code).toBe("2160-0");
    });
  });
});
