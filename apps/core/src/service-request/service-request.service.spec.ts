/**
 * Unit tests for ServiceRequestService — focused on the quick-entry addition
 * (extractFromAdHocText + the adHocText-aware confirmAndCreate path). The
 * existing document-scanning behavior (extractCandidates) is covered too, to
 * confirm the matchCatalog() extraction didn't change its behavior.
 */

import { ServiceRequestService } from "./service-request.service";
import { PatientScopeService } from "../patient/patient-scope.service";
import type { EncryptionService } from "../security/encryption.service";
import type { Pool, QueryResult } from "pg";

const mockScopeService = {
  assertPatientInScope: jest.fn(),
} as unknown as PatientScopeService;

// Reversible fake — enough for tests that don't specifically exercise the
// draft-decrypt path (see the dedicated "signed draft decryption" describe
// block below for real-provider coverage).
function makeEncryption(): EncryptionService {
  return {
    encrypt: jest.fn(async (text: string) => ({ ciphertext: `enc:${text}`, keyId: "test:v1" })),
    decrypt: jest.fn(async (ciphertext: string) => ciphertext.replace(/^enc:/, "")),
  } as unknown as EncryptionService;
}

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

describe("ServiceRequestService", () => {
  const USER_ID = "user-001";
  const PATIENT_ID = "patient-001";

  beforeEach(() => {
    jest.clearAllMocks();
    (mockScopeService.assertPatientInScope as jest.Mock).mockResolvedValue(undefined);
  });

  describe("extractFromAdHocText", () => {
    it("matches without any ORDER_CONTEXT wording (quick-entry box is itself an ordering context)", async () => {
      const svc = new ServiceRequestService({} as Pool, mockScopeService, makeEncryption());
      const result = await svc.extractFromAdHocText(USER_ID, PATIENT_ID, "chest x-ray, CBC");

      const displays = result.map((c) => c.code_display).sort();
      expect(displays).toEqual(["Chest X-ray", "Complete blood count (CBC)"]);
      expect(result.every((c) => c.source_type === "dictated_quick_entry")).toBe(true);
      expect(result.every((c) => c.source_document_id === null)).toBe(true);
      expect(result.every((c) => c.source_excerpt === "chest x-ray, CBC")).toBe(true);
    });

    it("drops the generic X-ray when Chest X-ray also matches the same phrase", async () => {
      const svc = new ServiceRequestService({} as Pool, mockScopeService, makeEncryption());
      const result = await svc.extractFromAdHocText(USER_ID, PATIENT_ID, "chest x-ray");

      expect(result.map((c) => c.code_display)).toEqual(["Chest X-ray"]);
    });

    it("returns empty for blank input without touching the pool", async () => {
      const pool = { query: jest.fn() } as unknown as Pool;
      const svc = new ServiceRequestService(pool, mockScopeService, makeEncryption());
      const result = await svc.extractFromAdHocText(USER_ID, PATIENT_ID, "   ");

      expect(result).toEqual([]);
      expect((pool.query as jest.Mock)).not.toHaveBeenCalled();
    });

    it("returns empty when nothing in the catalog matches", async () => {
      const svc = new ServiceRequestService({} as Pool, mockScopeService, makeEncryption());
      const result = await svc.extractFromAdHocText(USER_ID, PATIENT_ID, "check on the patient");

      expect(result).toEqual([]);
    });
  });

  describe("extractCandidates (unchanged behavior after the matchCatalog refactor)", () => {
    it("only matches sentences with ORDER_CONTEXT wording", async () => {
      const pool = makeMockPool({
        "hospital.document_reference": [
          { id: "doc-1", content_text: "Chest x-ray was normal. CBC ordered for tomorrow." },
        ],
        "app.document_draft": [],
      });
      const svc = new ServiceRequestService(pool, mockScopeService, makeEncryption());
      const result = await svc.extractCandidates(USER_ID, PATIENT_ID);

      // "Chest x-ray was normal" has no ordering verb -> not a candidate.
      // "CBC ordered for tomorrow" does -> is a candidate.
      expect(result.map((c) => c.code_display)).toEqual(["Complete blood count (CBC)"]);
      expect(result[0]?.source_type).toBe("document_reference");
      expect(result[0]?.source_document_id).toBe("doc-1");
    });

    it("decrypts an envelope-encrypted signed draft (signed_text_key_id set) before scanning it", async () => {
      const encryption = makeEncryption();
      const pool = makeMockPool({
        "hospital.document_reference": [],
        "app.document_draft": [
          { id: "draft-1", signed_text: "enc:CBC ordered on discharge.", signed_text_key_id: "test:v1" },
        ],
      });
      const svc = new ServiceRequestService(pool, mockScopeService, encryption);
      const result = await svc.extractCandidates(USER_ID, PATIENT_ID);

      expect(encryption.decrypt).toHaveBeenCalledWith("enc:CBC ordered on discharge.", "test:v1");
      expect(result.map((c) => c.code_display)).toEqual(["Complete blood count (CBC)"]);
      expect(result[0]?.source_type).toBe("document_draft");
    });

    it("treats a signed draft with no signed_text_key_id as legacy plaintext (no decrypt call)", async () => {
      const encryption = makeEncryption();
      const pool = makeMockPool({
        "hospital.document_reference": [],
        "app.document_draft": [
          { id: "draft-1", signed_text: "CBC ordered on discharge.", signed_text_key_id: null },
        ],
      });
      const svc = new ServiceRequestService(pool, mockScopeService, encryption);
      const result = await svc.extractCandidates(USER_ID, PATIENT_ID);

      expect(encryption.decrypt).not.toHaveBeenCalled();
      expect(result.map((c) => c.code_display)).toEqual(["Complete blood count (CBC)"]);
    });
  });

  describe("confirmAndCreate — ad hoc re-derivation", () => {
    it("re-derives the ad hoc candidate server-side and ignores client-supplied fields", async () => {
      const pool = makeMockPool({
        "hospital.document_reference": [],
        "app.document_draft": [],
        "INSERT INTO app.service_request": [
          {
            id: "sr-1",
            category: "imaging",
            code: "399208008",
            code_display: "Chest X-ray",
            status: "active",
            source_excerpt: "chest x-ray",
            requested_at: "2026-07-10T00:00:00Z",
          },
        ],
      });
      const svc = new ServiceRequestService(pool, mockScopeService, makeEncryption());

      // Client sends a bogus excerpt/category alongside a valid code — only
      // the code is used as the lookup key; everything else must be re-derived.
      const created = await svc.confirmAndCreate(
        USER_ID,
        PATIENT_ID,
        [
          {
            category: "not-real",
            code_system: "not-real",
            code: "399208008",
            code_display: "not-real",
            source_type: "not-real",
            source_document_id: "not-real",
            source_excerpt: "not-real",
          },
        ],
        "chest x-ray",
      );

      expect(created).toHaveLength(1);
      expect(created[0]?.code_display).toBe("Chest X-ray");

      // Confirm the INSERT was actually issued with server-derived values,
      // not the client's bogus ones.
      const insertCall = (pool.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
        sql.includes("INSERT INTO app.service_request"),
      );
      expect(insertCall).toBeDefined();
      const params = insertCall![1] as unknown[];
      // [patientId, category, code_system, code, code_display, source_document_id, source_type, source_excerpt, userId, fhir_json]
      expect(params[1]).toBe("imaging");
      expect(params[4]).toBe("Chest X-ray");
      expect(params[5]).toBeNull(); // source_document_id
      expect(params[6]).toBe("dictated_quick_entry");
      expect(params[7]).toBe("chest x-ray");
    });

    it("silently drops a confirmed code that isn't in either the documented or ad hoc extraction", async () => {
      const pool = makeMockPool({
        "hospital.document_reference": [],
        "app.document_draft": [],
      });
      const svc = new ServiceRequestService(pool, mockScopeService, makeEncryption());

      const created = await svc.confirmAndCreate(
        USER_ID,
        PATIENT_ID,
        [{ category: "x", code_system: "x", code: "does-not-exist", code_display: "x", source_type: "x", source_document_id: null, source_excerpt: "x" }],
        "chest pain, no imaging mentioned here",
      );

      expect(created).toEqual([]);
    });
  });
});
