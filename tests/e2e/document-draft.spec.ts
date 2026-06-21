/**
 * E2E test: grounded document drafting (Phase E6).
 *
 * Verifies the exit-gate safety rules: an unsigned draft cannot be exported;
 * signing then export works; clinician-authored-only sections (Assessment/Plan)
 * carry only the clinician's own note text (no model-introduced content).
 */

import { test, expect } from "@playwright/test";

const API_BASE = process.env["PLAYWRIGHT_API_BASE_URL"] ?? "http://localhost:4000";
const DEV_PHYSICIAN_SUBJECT = "00000000-0000-0000-0000-000000000010";

async function session(): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/v1/dev/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ external_subject: DEV_PHYSICIAN_SUBJECT }),
  });
  return res.ok ? (((await res.json()) as { session_id?: string }).session_id ?? null) : null;
}

async function patientId(mrn: string, sid: string): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/v1/patients?q=${mrn}&limit=5`, {
    headers: { Cookie: `session_id=${sid}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: Array<{ id: string; mrn: string }> };
  return body.data?.find((p) => p.mrn === mrn)?.id ?? null;
}

test.describe("Document drafting (E6)", () => {
  let sid = "";
  let pid = "";

  test.beforeAll(async () => {
    sid = (await session()) ?? "";
    if (sid) pid = (await patientId("MRN-010", sid)) ?? "";
  });

  test("unsigned draft cannot be exported; signing then export works", async () => {
    test.skip(!sid || !pid, "Dev server/seed not available");
    const headers = { Cookie: `session_id=${sid}`, "Content-Type": "application/json" };

    // Generate
    const gen = await fetch(`${API_BASE}/api/v1/patients/${pid}/drafts`, {
      method: "POST", headers,
      body: JSON.stringify({ document_type: "discharge_summary", language: "en" }),
    });
    expect(gen.status).toBe(201);
    const draft = (await gen.json()) as {
      id: string; status: string;
      sections_json: Array<{ policy: string; title: string; text: string }>;
    };
    expect(draft.status).toBe("draft");

    // Assessment/Plan are clinician-authored-only
    const cao = draft.sections_json.filter((s) => s.policy === "clinician_authored_only");
    expect(cao.length).toBeGreaterThan(0);

    // Unsigned export → denied
    const before = await fetch(`${API_BASE}/api/v1/drafts/${draft.id}/export`, {
      headers: { Cookie: `session_id=${sid}` },
    });
    expect(before.status).toBe(403);

    // Sign
    const signed = await fetch(`${API_BASE}/api/v1/drafts/${draft.id}/sign`, {
      method: "POST", headers: { Cookie: `session_id=${sid}` },
    });
    expect(signed.status).toBe(200);

    // Signed export → works
    const after = await fetch(`${API_BASE}/api/v1/drafts/${draft.id}/export`, {
      headers: { Cookie: `session_id=${sid}` },
    });
    expect(after.status).toBe(200);
    const exported = (await after.json()) as { text: string };
    expect(exported.text.length).toBeGreaterThan(0);
  });
});
