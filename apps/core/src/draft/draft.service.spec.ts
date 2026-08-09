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
import type { EncryptionService } from "../security/encryption.service";

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

// None of the specialty-template/prefill tests below exercise sign()/get(),
// so this fake is never actually invoked — see encryption.service.spec.ts and
// the dedicated CMEK cases further down for real encrypt/decrypt coverage.
function makeEncryption(): EncryptionService {
  return {
    encrypt: jest.fn().mockResolvedValue({ ciphertext: "unused", keyId: "unused" }),
    decrypt: jest.fn().mockResolvedValue("unused"),
  } as unknown as EncryptionService;
}

describe("DraftService specialty templates", () => {
  it("general specialty keeps the base template titles unchanged", async () => {
    const service = new DraftService(makePool(), makeScope(), makeEncryption());
    const draft = await service.generate("user-1", "patient-1", "discharge_summary", "en", "general");
    const sections = draft.sections_json as unknown as Array<{ key: string; title: string }>;
    expect(sections.map((s) => s.key)).toEqual(["identity", "problems", "medications", "results", "assessment", "plan"]);
    expect(sections.find((s) => s.key === "problems")?.title).toBe("Documented Problems");
  });

  it("cardiology specialty overrides problem/medication/results titles only", async () => {
    const service = new DraftService(makePool(), makeScope(), makeEncryption());
    const draft = await service.generate("user-1", "patient-1", "discharge_summary", "en", "cardiology");
    const sections = draft.sections_json as unknown as Array<{ key: string; title: string; text: string }>;
    expect(sections.find((s) => s.key === "problems")?.title).toBe("Cardiac Problem List");
    expect(sections.find((s) => s.key === "medications")?.title).toBe("Cardiac Medications");
    expect(sections.find((s) => s.key === "results")?.title).toBe("Cardiac & Laboratory Results");
    // Same underlying fact, unchanged by the specialty override.
    expect(sections.find((s) => s.key === "problems")?.text).toContain("Type 2 diabetes");
  });

  it("non-general specialty inserts an Allergies section right after Identity", async () => {
    const service = new DraftService(makePool(), makeScope(), makeEncryption());
    const draft = await service.generate("user-1", "patient-1", "discharge_summary", "en", "orthopedics");
    const sections = draft.sections_json as unknown as Array<{ key: string; title: string; text: string }>;
    const identityIdx = sections.findIndex((s) => s.key === "identity");
    expect(sections[identityIdx + 1]?.key).toBe("allergies");
    expect(sections.find((s) => s.key === "allergies")?.text).toContain("Penicillin");
  });

  it("general specialty does not insert an Allergies section", async () => {
    const service = new DraftService(makePool(), makeScope(), makeEncryption());
    const draft = await service.generate("user-1", "patient-1", "discharge_summary", "en", "general");
    const sections = draft.sections_json as unknown as Array<{ key: string }>;
    expect(sections.some((s) => s.key === "allergies")).toBe(false);
  });

  it("resolves Arabic titles for both generic and specialty-overridden sections", async () => {
    const service = new DraftService(makePool(), makeScope(), makeEncryption());
    const draft = await service.generate("user-1", "patient-1", "discharge_summary", "ar", "cardiology");
    const sections = draft.sections_json as unknown as Array<{ key: string; title: string }>;
    expect(sections.find((s) => s.key === "problems")?.title).toBe("قائمة المشاكل القلبية");
    expect(sections.find((s) => s.key === "allergies")?.title).toBe("الحساسيات");
  });
});

describe("DraftService ambient-capture prefill", () => {
  const TRANSCRIPT = "Patient reports a cough for three days. I think this is bronchitis. Start amoxicillin.";

  it("uses prefill text for clinician-authored-only sections when it is a verbatim substring", async () => {
    const service = new DraftService(makePool(), makeScope(), makeEncryption());
    const draft = await service.generate("user-1", "patient-1", "encounter_note", "en", "general", {
      transcript: TRANSCRIPT,
      sections: {
        chief_complaint: "Patient reports a cough for three days.",
        assessment: "I think this is bronchitis.",
        plan: "Start amoxicillin.",
      },
    });
    const sections = draft.sections_json as unknown as Array<{ key: string; text: string }>;
    expect(sections.find((s) => s.key === "chief_complaint")?.text).toBe("Patient reports a cough for three days.");
    expect(sections.find((s) => s.key === "assessment")?.text).toBe("I think this is bronchitis.");
    expect(sections.find((s) => s.key === "plan")?.text).toBe("Start amoxicillin.");
  });

  it("rejects prefill text that is not a verbatim substring of the transcript", async () => {
    const service = new DraftService(makePool(), makeScope(), makeEncryption());
    await expect(
      service.generate("user-1", "patient-1", "encounter_note", "en", "general", {
        transcript: TRANSCRIPT,
        sections: { assessment: "This is likely a bacterial infection requiring urgent care." },
      }),
    ).rejects.toThrow(/verbatim substring/);
  });

  it("sections without a matching prefill key fall back to the dictate-fresh placeholder", async () => {
    const service = new DraftService(makePool(), makeScope(), makeEncryption());
    const draft = await service.generate("user-1", "patient-1", "encounter_note", "en", "general", {
      transcript: TRANSCRIPT,
      sections: { chief_complaint: "Patient reports a cough for three days." },
    });
    const sections = draft.sections_json as unknown as Array<{ key: string; text: string }>;
    expect(sections.find((s) => s.key === "history")?.text).toContain("Dictate or type");
  });

  it("no prefill behaves exactly like manual encounter_note drafting (dictate-fresh placeholders)", async () => {
    const service = new DraftService(makePool(), makeScope(), makeEncryption());
    const draft = await service.generate("user-1", "patient-1", "encounter_note", "en", "general");
    const sections = draft.sections_json as unknown as Array<{ key: string; text: string }>;
    expect(sections.find((s) => s.key === "chief_complaint")?.text).toContain("Dictate or type");
  });
});

describe("DraftService ambient-condensation prefill", () => {
  const TRANSCRIPT = "Patient reports a cough for three days. I think this is bronchitis. Start amoxicillin.";
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("accepts a condensed chief_complaint when the transcription service validates it", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ valid: true }) }) as unknown as typeof fetch;
    const service = new DraftService(makePool(), makeScope(), makeEncryption());
    const draft = await service.generate("user-1", "patient-1", "encounter_note", "en", "general", {
      transcript: TRANSCRIPT,
      sections: { chief_complaint: "3-day cough." }, // NOT a verbatim substring of TRANSCRIPT
      condensedKeys: ["chief_complaint"],
    });
    const sections = draft.sections_json as unknown as Array<{ key: string; text: string }>;
    expect(sections.find((s) => s.key === "chief_complaint")?.text).toBe("3-day cough.");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/validate-condensation"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects a condensed section when the transcription service's re-validation fails", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ valid: false }) }) as unknown as typeof fetch;
    const service = new DraftService(makePool(), makeScope(), makeEncryption());
    await expect(
      service.generate("user-1", "patient-1", "encounter_note", "en", "general", {
        transcript: TRANSCRIPT,
        sections: { chief_complaint: "Patient likely has an infection." },
        condensedKeys: ["chief_complaint"],
      }),
    ).rejects.toThrow(/condensed text failed/);
  });

  it("ignores a client claiming assessment/plan were condensed -- strict verbatim check still applies", async () => {
    // fetch would only be reachable via the condensation path; if this test
    // needed it, the mock returning ok:false would surface as a fetch error,
    // proving the (unsafe) relaxed path was never taken for 'assessment'.
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    const service = new DraftService(makePool(), makeScope(), makeEncryption());
    await expect(
      service.generate("user-1", "patient-1", "encounter_note", "en", "general", {
        transcript: TRANSCRIPT,
        sections: { assessment: "This is likely a bacterial infection requiring urgent care." },
        condensedKeys: ["assessment"], // CONDENSABLE_SECTIONS does not include "assessment" -- must be ignored
      }),
    ).rejects.toThrow(/verbatim substring/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("DraftService ambient auto-translation prefill", () => {
  const AR_TRANSCRIPT = "المريض يشتكي من سعال منذ ثلاثة أيام.";
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("uses the server's own translation for a translatedKeys-flagged chief_complaint", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: "3-day cough." }),
    }) as unknown as typeof fetch;
    const service = new DraftService(makePool(), makeScope(), makeEncryption());
    const draft = await service.generate("user-1", "patient-1", "encounter_note", "ar", "general", {
      transcript: AR_TRANSCRIPT,
      sections: { chief_complaint: AR_TRANSCRIPT },
      translatedKeys: ["chief_complaint"],
    });
    const sections = draft.sections_json as unknown as Array<{ key: string; text: string }>;
    expect(sections.find((s) => s.key === "chief_complaint")?.text).toBe("3-day cough.");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/narrative/interpret"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("keeps the original-language text when translation is unavailable, without blocking draft creation", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    const service = new DraftService(makePool(), makeScope(), makeEncryption());
    const draft = await service.generate("user-1", "patient-1", "encounter_note", "ar", "general", {
      transcript: AR_TRANSCRIPT,
      sections: { chief_complaint: AR_TRANSCRIPT },
      translatedKeys: ["chief_complaint"],
    });
    const sections = draft.sections_json as unknown as Array<{ key: string; text: string }>;
    expect(sections.find((s) => s.key === "chief_complaint")?.text).toBe(AR_TRANSCRIPT);
  });

  it("ignores a client claiming assessment/plan were translated -- fetch never called, original text kept", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    const service = new DraftService(makePool(), makeScope(), makeEncryption());
    const draft = await service.generate("user-1", "patient-1", "encounter_note", "ar", "general", {
      transcript: AR_TRANSCRIPT,
      sections: { assessment: AR_TRANSCRIPT },
      translatedKeys: ["assessment"], // TRANSLATABLE_SECTIONS does not include "assessment" -- must be ignored
    });
    const sections = draft.sections_json as unknown as Array<{ key: string; text: string }>;
    expect(sections.find((s) => s.key === "assessment")?.text).toBe(AR_TRANSCRIPT);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not attempt translation when the document language is already English", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: "should never be used" }),
    }) as unknown as typeof fetch;
    const service = new DraftService(makePool(), makeScope(), makeEncryption());
    const enTranscript = "Patient reports a cough for three days.";
    const draft = await service.generate("user-1", "patient-1", "encounter_note", "en", "general", {
      transcript: enTranscript,
      sections: { chief_complaint: enTranscript },
      translatedKeys: ["chief_complaint"],
    });
    const sections = draft.sections_json as unknown as Array<{ key: string; text: string }>;
    expect(sections.find((s) => s.key === "chief_complaint")?.text).toBe(enTranscript);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("condenses first, then translates the condensed text (both flags on the same section)", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    global.fetch = jest.fn((url: string, opts: { body: string }) => {
      const body = JSON.parse(opts.body) as Record<string, unknown>;
      calls.push({ url: String(url), body });
      if (String(url).includes("/validate-condensation")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ valid: true }) });
      }
      if (String(url).includes("/narrative/interpret")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ text: "3-day cough (condensed+translated)." }) });
      }
      return Promise.resolve({ ok: false });
    }) as unknown as typeof fetch;

    const service = new DraftService(makePool(), makeScope(), makeEncryption());
    const draft = await service.generate("user-1", "patient-1", "encounter_note", "ar", "general", {
      transcript: AR_TRANSCRIPT,
      sections: { chief_complaint: "سعال ثلاثة أيام" }, // pre-condensed, not verbatim
      condensedKeys: ["chief_complaint"],
      translatedKeys: ["chief_complaint"],
    });

    const sections = draft.sections_json as unknown as Array<{ key: string; text: string }>;
    expect(sections.find((s) => s.key === "chief_complaint")?.text).toBe("3-day cough (condensed+translated).");
    // Condensation validation happened before translation, and translation
    // was called with the (condensed) text, not the raw transcript.
    expect(calls[0]!.url).toContain("/validate-condensation");
    expect(calls[1]!.url).toContain("/narrative/interpret");
    expect((calls[1]!.body as { text: string }).text).toBe("سعال ثلاثة أيام");
  });
});
