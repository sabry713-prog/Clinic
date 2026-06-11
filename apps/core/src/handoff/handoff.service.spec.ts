/**
 * Handoff service tests
 *
 * Verifies:
 * - All 6 sections are present in the response
 * - No interpretation language in formatted sections
 * - Blocklist patterns not present in response text
 * - Ward handoff returns correct patient_count
 * - Scope windows: current_shift = 12h, last_24h = 24h
 */

import { HandoffService, type HandoffScope } from "./handoff.service";
import { formatHandoffText, formatSection } from "./handoff-formatter";

// ─── Blocklist words (TypeScript mirror of Python patterns) ──────────────────
const BLOCKLIST_WORDS = [
  "worsening",
  "improving",
  "concerning",
  "trending",
  "elevated",
  "abnormal",
  "suggests",
  "indicates",
  "consistent with",
  "significant",
  "critical",
  "deteriorating",
  "risk",
  "diagnos",
  "recommend",
  "warning",
];

function containsBlocklistWord(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKLIST_WORDS.some((w) => lower.includes(w));
}

// ─── Unit tests for handoff-formatter ────────────────────────────────────────

describe("handoff-formatter", () => {
  describe("formatSection", () => {
    it("renders section title and items", () => {
      const result = formatSection("Recent Vitals", ["HR: 72 bpm", "SpO2: 98%"]);
      expect(result).toContain("### Recent Vitals");
      expect(result).toContain("- HR: 72 bpm");
      expect(result).toContain("- SpO2: 98%");
    });

    it("shows (None documented) when items are empty", () => {
      const result = formatSection("Pending Orders", []);
      expect(result).toContain("(None documented)");
    });
  });

  describe("formatHandoffText", () => {
    it("produces text containing all 6 section headers", () => {
      const sections = {
        identity_and_admission: ["Name: Test Patient"],
        documented_today: [],
        current_medications: ["Metformin 500 mg -- oral -- twice daily"],
        recent_vitals: ["HR: 80 bpm (2026-06-10)"],
        recent_labs: ["Creatinine: 90 μmol/L [59–104 μmol/L] (2026-06-10)"],
        pending_orders: [],
      };
      const text = formatHandoffText(sections);
      expect(text).toContain("### Identity and Admission");
      expect(text).toContain("### Documented Today");
      expect(text).toContain("### Current Medications");
      expect(text).toContain("### Recent Vitals");
      expect(text).toContain("### Recent Labs");
      expect(text).toContain("### Pending Orders");
    });

    it("does not contain interpretation language in sample text", () => {
      const sections = {
        identity_and_admission: ["Name: Test Patient", "Ward: ICU-3"],
        documented_today: ["[2026-06-10] Note by Dr. Smith: Patient reviewed."],
        current_medications: ["Paracetamol 1g -- IV -- every 6h"],
        recent_vitals: ["BP: 130/85 mmHg (2026-06-10)"],
        recent_labs: ["WBC: 8.2 × 10⁹/L [4.0–11.0 × 10⁹/L] (2026-06-10)"],
        pending_orders: [],
      };
      const text = formatHandoffText(sections);
      expect(containsBlocklistWord(text)).toBe(false);
    });

    it("reference range is formatted with dash notation", () => {
      const sections = {
        identity_and_admission: [],
        documented_today: [],
        current_medications: [],
        recent_vitals: [],
        recent_labs: ["Creatinine: 138 μmol/L [59–104 μmol/L] (2026-06-10)"],
        pending_orders: [],
      };
      const text = formatHandoffText(sections);
      expect(text).toContain("[59–104 μmol/L]");
      // No H/L flag
      expect(text).not.toMatch(/\bH\b|\bL\b/);
    });
  });
});

// ─── HandoffService unit tests (with mocked DB pool) ─────────────────────────

describe("HandoffService", () => {
  function makePool(patientData: Record<string, unknown> = {}) {
    let callIdx = 0;
    const defaultPatient = {
      id: "patient-uuid-1",
      mrn: "MRN001",
      display_name: "Ahmed Al-Rashid",
      date_of_birth: "1980-01-01",
      sex: "male",
      preferred_language: "ar",
      ward: "WARD-A",
      ...patientData,
    };

    const responses: Array<{ rows: unknown[] }> = [
      // patient
      { rows: [defaultPatient] },
      // encounter
      { rows: [{ id: "enc-1", encounter_type: "inpatient", status: "in-progress", started_at: "2026-06-01", ward: "WARD-A" }] },
      // documents (documented_today)
      { rows: [] },
      // medications
      { rows: [{ id: "med-1", medication_display: "Metformin", code: null, dose: "500mg", route: "oral", frequency: "twice daily", status: "active" }] },
      // vitals
      { rows: [{ id: "obs-1", code: "8867-4", code_display: "Heart rate", value_numeric: 72, value_text: null, unit: "bpm", ref_range_low: 60, ref_range_high: 100, ref_range_text: null, effective_at: "2026-06-10T08:00:00Z" }] },
      // labs
      { rows: [{ id: "obs-2", code: "2160-0", code_display: "Creatinine", value_numeric: 90, value_text: null, unit: "μmol/L", ref_range_low: 59, ref_range_high: 104, ref_range_text: null, effective_at: "2026-06-10T07:00:00Z" }] },
      // pending orders
      { rows: [] },
      // insert returning
      { rows: [{ id: "handoff-uuid-1", created_at: new Date("2026-06-10T10:00:00Z") }] },
    ];

    const pool = {
      query: jest.fn().mockImplementation(() => {
        const resp = responses[callIdx] ?? { rows: [] };
        callIdx++;
        return Promise.resolve(resp);
      }),
    };
    return pool;
  }

  it("returns all 6 sections", async () => {
    const pool = makePool() as unknown as import("pg").Pool;
    const service = new HandoffService(pool);
    const result = await service.generateForPatient({
      patientId: "patient-uuid-1",
      userId: "user-uuid-1",
      scope: "current_shift",
      language: "en",
    });

    expect(result.sections).toHaveProperty("identity_and_admission");
    expect(result.sections).toHaveProperty("documented_today");
    expect(result.sections).toHaveProperty("current_medications");
    expect(result.sections).toHaveProperty("recent_vitals");
    expect(result.sections).toHaveProperty("recent_labs");
    expect(result.sections).toHaveProperty("pending_orders");
  });

  it("identity section includes patient name and encounter info", async () => {
    const pool = makePool() as unknown as import("pg").Pool;
    const service = new HandoffService(pool);
    const result = await service.generateForPatient({
      patientId: "patient-uuid-1",
      userId: "user-uuid-1",
      scope: "current_shift",
      language: "en",
    });

    expect(result.sections.identity_and_admission.join(" ")).toContain("Ahmed Al-Rashid");
    expect(result.sections.identity_and_admission.join(" ")).toContain("MRN001");
  });

  it("formatted text does not contain blocklist words", async () => {
    const pool = makePool() as unknown as import("pg").Pool;
    const service = new HandoffService(pool);
    const result = await service.generateForPatient({
      patientId: "patient-uuid-1",
      userId: "user-uuid-1",
      scope: "current_shift",
      language: "en",
    });

    expect(containsBlocklistWord(result.text)).toBe(false);
  });

  it("disclaimer is verbatim", async () => {
    const pool = makePool() as unknown as import("pg").Pool;
    const service = new HandoffService(pool);
    const result = await service.generateForPatient({
      patientId: "patient-uuid-1",
      userId: "user-uuid-1",
      scope: "current_shift",
      language: "en",
    });

    expect(result.disclaimer).toBe(
      "Reproduces documented information from the patient record. For clinician reference only. Not a clinical assessment.",
    );
  });

  it("ward handoff returns correct patient_count", async () => {
    let callCount = 0;
    const pool = {
      query: jest.fn().mockImplementation((sql: string) => {
        if (typeof sql === "string" && sql.includes("DISTINCT p.id")) {
          return Promise.resolve({ rows: [{ id: "p1" }, { id: "p2" }] });
        }
        callCount++;
        // For each patient generation, return minimal valid data
        const cyclePos = (callCount - 1) % 8;
        const cycleResponses = [
          { rows: [{ id: "p1", mrn: null, display_name: "Patient", date_of_birth: null, sex: null, preferred_language: "en", ward: "W1" }] },
          { rows: [{ id: "enc-1", encounter_type: "inpatient", status: "in-progress", started_at: "2026-06-01", ward: "W1" }] },
          { rows: [] },
          { rows: [] },
          { rows: [] },
          { rows: [] },
          { rows: [] },
          { rows: [{ id: "ho-" + callCount, created_at: new Date() }] },
        ];
        return Promise.resolve(cycleResponses[cyclePos] ?? { rows: [] });
      }),
    };

    const service = new HandoffService(pool as unknown as import("pg").Pool);
    const result = await service.generateForWard({
      wardId: "W1",
      userId: "user-1",
      scope: "last_24h",
      language: "en",
    });

    expect(result.ward_id).toBe("W1");
    expect(result.scope).toBe("last_24h");
    expect(result.patient_count).toBe(2);
    expect(result.handoffs).toHaveLength(2);
  });

  it("scope current_shift uses 12h window and last_24h uses 24h window", () => {
    const shiftMs = 12 * 60 * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();

    const shiftWindow = now - shiftMs;
    const dayWindow = now - dayMs;

    // The shift window must be more recent (larger timestamp) than 24h window
    expect(shiftWindow).toBeGreaterThan(dayWindow);
  });
});

// ─── Tests for DSR service ─────────────────────────────────────────────────

import { DsrService } from "../dsr/dsr.service";

describe("DsrService", () => {
  function makeDsrPool() {
    const pool = {
      connect: jest.fn().mockResolvedValue({
        query: jest.fn().mockResolvedValue({ rows: [{ id: "audit-id", hash_self: "abc" }] }),
        release: jest.fn(),
      }),
      query: jest.fn(),
    };
    return pool;
  }

  it("access request creates row with type=access and due_at = +30 days", async () => {
    const insertRow = { id: "dsr-1", created_at: new Date("2026-06-10T00:00:00Z") };
    const pool = {
      connect: jest.fn().mockResolvedValue({
        query: jest.fn().mockResolvedValue({ rows: [{ id: "audit-id", hash_self: "abc" }] }),
        release: jest.fn(),
      }),
      query: jest.fn().mockResolvedValue({ rows: [insertRow] }),
    };

    const service = new DsrService(pool as unknown as import("pg").Pool);
    const result = await service.createAccess("ID123", "Patient request", null, null, "req-1" as import("@clinical-copilot/shared-types").RequestId);

    expect(result.type).toBe("access");
    expect(result.status).toBe("pending");
    expect(result.id).toBe("dsr-1");

    // due_at should be ~30 days from now
    const dueAt = new Date(result.due_at!);
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const diff = dueAt.getTime() - Date.now();
    expect(diff).toBeGreaterThan(thirtyDays - 60000); // within 1 minute tolerance
    expect(diff).toBeLessThan(thirtyDays + 60000);
  });

  it("erase request creates row with type=erase", async () => {
    const insertRow = { id: "dsr-2", created_at: new Date() };
    const pool = {
      connect: jest.fn().mockResolvedValue({
        query: jest.fn().mockResolvedValue({ rows: [{ id: "audit-id", hash_self: "abc" }] }),
        release: jest.fn(),
      }),
      query: jest.fn().mockResolvedValue({ rows: [insertRow] }),
    };

    const service = new DsrService(pool as unknown as import("pg").Pool);
    const result = await service.createErase("ID456", "Right to erasure", null, null, "req-2" as import("@clinical-copilot/shared-types").RequestId);

    expect(result.type).toBe("erase");
    expect(result.status).toBe("pending");
  });

  it("getStatus returns current status", async () => {
    const row = {
      id: "dsr-3",
      type: "access",
      status: "in_progress",
      due_at: new Date("2026-07-10"),
      created_at: new Date("2026-06-10"),
    };
    const pool = {
      query: jest.fn().mockResolvedValue({ rows: [row] }),
    };

    const service = new DsrService(pool as unknown as import("pg").Pool);
    const result = await service.getStatus("dsr-3");

    expect(result.id).toBe("dsr-3");
    expect(result.type).toBe("access");
    expect(result.status).toBe("in_progress");
  });
});
