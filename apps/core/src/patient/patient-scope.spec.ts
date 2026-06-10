/**
 * Unit tests for RBAC scope check.
 * Uses a mock Pool that simulates the DB responses.
 */

import { PatientScopeService } from "./patient-scope.service";
import type { Pool, QueryResult } from "pg";
import { ForbiddenException } from "@nestjs/common";

function makePool(queryMap: Record<string, unknown>): Pool {
  const pool = {
    query: jest.fn((sql: string, _params?: unknown[]) => {
      // Match by key substring
      for (const [key, value] of Object.entries(queryMap)) {
        if (sql.includes(key)) {
          return Promise.resolve(value as QueryResult);
        }
      }
      return Promise.resolve({ rows: [] } as unknown as QueryResult);
    }),
  } as unknown as Pool;
  return pool;
}

describe("PatientScopeService", () => {
  const USER_ID = "user-uuid-001";
  const PATIENT_IN_SCOPE = "patient-uuid-001";
  const PATIENT_OUT_OF_SCOPE = "patient-uuid-999";

  describe("getScopedPatientIds", () => {
    it("returns cached scope when cache is warm", async () => {
      const pool = makePool({
        "app.patient_scope": {
          rows: [{ patient_id: PATIENT_IN_SCOPE }],
        } as QueryResult,
      });

      const svc = new PatientScopeService(pool);
      const result = await svc.getScopedPatientIds(USER_ID);
      expect(result.has(PATIENT_IN_SCOPE)).toBe(true);
    });

    it("rebuilds scope from encounters on cache miss", async () => {
      const querySpy = jest.fn((sql: string, _params?: unknown[]) => {
        if (sql.includes("app.patient_scope") && sql.includes("expires_at > now")) {
          return Promise.resolve({ rows: [] } as unknown as QueryResult);
        }
        if (sql.includes("hospital.encounter")) {
          return Promise.resolve({ rows: [{ patient_id: PATIENT_IN_SCOPE }] } as unknown as QueryResult);
        }
        if (sql.includes("app.user_role")) {
          return Promise.resolve({ rows: [{ role: "physician" }] } as unknown as QueryResult);
        }
        // DELETE and INSERT operations
        return Promise.resolve({ rows: [] } as unknown as QueryResult);
      });

      const pool = { query: querySpy } as unknown as Pool;
      const svc = new PatientScopeService(pool);
      const result = await svc.getScopedPatientIds(USER_ID);
      expect(result.has(PATIENT_IN_SCOPE)).toBe(true);
    });

    it("returns empty set when user has no encounters", async () => {
      const querySpy = jest.fn((sql: string) => {
        if (sql.includes("app.patient_scope") && sql.includes("expires_at > now")) {
          return Promise.resolve({ rows: [] } as unknown as QueryResult);
        }
        if (sql.includes("hospital.encounter")) {
          return Promise.resolve({ rows: [] } as unknown as QueryResult);
        }
        if (sql.includes("app.user_role")) {
          return Promise.resolve({ rows: [{ role: "physician" }] } as unknown as QueryResult);
        }
        return Promise.resolve({ rows: [] } as unknown as QueryResult);
      });

      const pool = { query: querySpy } as unknown as Pool;
      const svc = new PatientScopeService(pool);
      const result = await svc.getScopedPatientIds(USER_ID);
      expect(result.size).toBe(0);
    });
  });

  describe("assertPatientInScope", () => {
    it("resolves when patient is in scope", async () => {
      const pool = makePool({
        "app.patient_scope": {
          rows: [{ patient_id: PATIENT_IN_SCOPE }],
        } as QueryResult,
      });
      const svc = new PatientScopeService(pool);
      await expect(
        svc.assertPatientInScope(USER_ID, PATIENT_IN_SCOPE),
      ).resolves.toBeUndefined();
    });

    it("throws ForbiddenException with PATIENT_OUT_OF_SCOPE when not in scope", async () => {
      const querySpy = jest.fn((sql: string) => {
        if (sql.includes("app.patient_scope") && sql.includes("expires_at > now")) {
          return Promise.resolve({ rows: [{ patient_id: PATIENT_IN_SCOPE }] } as unknown as QueryResult);
        }
        return Promise.resolve({ rows: [] } as unknown as QueryResult);
      });
      const pool = { query: querySpy } as unknown as Pool;
      const svc = new PatientScopeService(pool);

      await expect(
        svc.assertPatientInScope(USER_ID, PATIENT_OUT_OF_SCOPE),
      ).rejects.toThrow(ForbiddenException);
    });

    it("error object contains PATIENT_OUT_OF_SCOPE code", async () => {
      const pool = makePool({
        "app.patient_scope": {
          rows: [{ patient_id: PATIENT_IN_SCOPE }],
        } as QueryResult,
      });
      const svc = new PatientScopeService(pool);

      try {
        await svc.assertPatientInScope(USER_ID, PATIENT_OUT_OF_SCOPE);
        fail("Expected ForbiddenException");
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const forbidden = err as ForbiddenException;
        const response = forbidden.getResponse() as { error?: { code?: string } };
        expect(response.error?.code).toBe("PATIENT_OUT_OF_SCOPE");
      }
    });
  });
});
