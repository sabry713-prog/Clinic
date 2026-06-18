/**
 * E2E test: medication reconciliation (Phase E1).
 *
 * Requires:
 *   - Web at PLAYWRIGHT_BASE_URL (default http://localhost:3000)
 *   - Core API at http://localhost:4000
 *   - Seeds run: `seed:dev` then `seed:reconciliation` (MRN-006 gets ehr + pharmacy feeds)
 *
 * Verifies the exit-gate scenario: a patient with discrepant source lists is
 * reconciled into factual differences only — no severity/flag/recommendation
 * language anywhere.
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env["PLAYWRIGHT_BASE_URL"] ?? "http://localhost:3000";
const API_BASE = process.env["PLAYWRIGHT_API_BASE_URL"] ?? "http://localhost:4000";
const DEV_PHYSICIAN_SUBJECT = "00000000-0000-0000-0000-000000000010";
const RECON_MRN = "MRN-006";

// Interpretive/severity vocabulary that must NEVER appear in factual reconciliation text.
const FORBIDDEN = [
  "worse", "better", "severe", "critical", "abnormal", "concern", "concerning",
  "danger", "recommend", "should", "alert", "warning", "risk", "significant",
  "interaction", "contraindicat", "urgent", "priority", "flag",
];

async function createDevSession(): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/v1/dev/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ external_subject: DEV_PHYSICIAN_SUBJECT }),
  });
  if (!res.ok) return null;
  return ((await res.json()) as { session_id?: string }).session_id ?? null;
}

async function patientIdByMrn(mrn: string, sid: string): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/v1/patients?q=${mrn}&limit=5`, {
    headers: { Cookie: `session_id=${sid}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: Array<{ id: string; mrn: string }> };
  return body.data?.find((p) => p.mrn === mrn)?.id ?? null;
}

test.describe("Medication reconciliation (E1)", () => {
  let sid = "";
  let patientId = "";

  test.beforeAll(async () => {
    sid = (await createDevSession()) ?? "";
    if (sid) patientId = (await patientIdByMrn(RECON_MRN, sid)) ?? "";
  });

  test("discrepant EHR vs pharmacy lists reconcile to factual differences only", async () => {
    test.skip(!sid || !patientId, "Dev server/seed not available");

    const res = await fetch(
      `${API_BASE}/api/v1/patients/${patientId}/medications/reconciliation`,
      { headers: { Cookie: `session_id=${sid}` } },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      sources: string[];
      reconciliation: Array<{
        medication_display: string | null;
        documented_in: string[];
        differences: string[];
      }>;
    };

    // Two feeds present
    expect(data.sources).toEqual(expect.arrayContaining(["ehr", "pharmacy"]));

    const byName = (n: string) =>
      data.reconciliation.find((m) => (m.medication_display ?? "").startsWith(n));

    // Dose difference stated factually
    const amlodipine = byName("Amlodipine");
    expect(amlodipine?.documented_in.sort()).toEqual(["ehr", "pharmacy"]);
    expect(amlodipine?.differences.join(" ")).toMatch(/dose strings differ/i);

    // One-sided medications
    expect(byName("Atorvastatin")?.documented_in).toEqual(["ehr"]);
    expect(byName("Warfarin")?.documented_in).toEqual(["pharmacy"]);

    // Agreeing medication has no differences
    expect(byName("Metformin")?.differences).toEqual([]);

    // No interpretive/severity language anywhere in the differences
    const allText = data.reconciliation
      .flatMap((m) => m.differences)
      .join(" ")
      .toLowerCase();
    for (const word of FORBIDDEN) {
      expect(allText).not.toContain(word);
    }
  });

  test("reconciliation panel renders on the patient page", async ({ page }) => {
    test.skip(!sid || !patientId, "Dev server/seed not available");
    await page.context().addCookies([{ name: "session_id", value: sid, url: BASE_URL }]);
    await page.goto(`${BASE_URL}/patients/${patientId}`);
    await expect(page.getByText("Medication Reconciliation")).toBeVisible({ timeout: 10_000 });
  });
});
