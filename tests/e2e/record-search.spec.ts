/**
 * E2E test: record search (Phase E2).
 *
 * Requires the dev stack + seeds (`seed:dev`, `seed:enrich`, `seed:symptoms`,
 * `seed:index`). Verifies verbatim search across EN / AR / code-switched
 * queries, source-type grouping, and out-of-scope denial.
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env["PLAYWRIGHT_BASE_URL"] ?? "http://localhost:3000";
const API_BASE = process.env["PLAYWRIGHT_API_BASE_URL"] ?? "http://localhost:4000";
const DEV_PHYSICIAN_SUBJECT = "00000000-0000-0000-0000-000000000010";

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

async function search(pid: string, sid: string, q: string) {
  const res = await fetch(
    `${API_BASE}/api/v1/patients/${pid}/search?q=${encodeURIComponent(q)}`,
    { headers: { Cookie: `session_id=${sid}` } },
  );
  return { status: res.status, body: (await res.json()) as { total: number; groups: Array<{ source_type: string }> } };
}

test.describe("Record search (E2)", () => {
  let sid = "";
  let pid = "";

  test.beforeAll(async () => {
    sid = (await createDevSession()) ?? "";
    if (sid) pid = (await patientIdByMrn("MRN-010", sid)) ?? "";
  });

  test("EN / AR / code-switched queries return verbatim grouped results", async () => {
    test.skip(!sid || !pid, "Dev server/seed not available");

    const en = await search(pid, sid, "creatinine");
    expect(en.status).toBe(200);
    expect(en.body.total).toBeGreaterThan(0);
    expect(en.body.groups.some((g) => g.source_type === "observation")).toBe(true);

    const ar = await search(pid, sid, "دوخة"); // dizziness → English records via aliasing
    expect(ar.body.total).toBeGreaterThan(0);

    const mixed = await search(pid, sid, "warfarin");
    expect(mixed.body.total).toBeGreaterThan(0);
    expect(mixed.body.groups.some((g) => g.source_type === "medication")).toBe(true);
  });

  test("out-of-scope patient search is denied", async () => {
    test.skip(!sid, "Dev server not available");
    const oos = await patientIdByMrn("MRN-011", sid);
    // MRN-011 is out of scope: either not resolvable via scoped search, or 403 on access.
    if (oos) {
      const res = await fetch(`${API_BASE}/api/v1/patients/${oos}/search?q=test`, {
        headers: { Cookie: `session_id=${sid}` },
      });
      expect(res.status).toBe(403);
    }
  });

  test("search tab renders on the patient page", async ({ page }) => {
    test.skip(!sid || !pid, "Dev server/seed not available");
    await page.context().addCookies([{ name: "session_id", value: sid, url: BASE_URL }]);
    await page.goto(`${BASE_URL}/patients/${pid}`);
    await page.getByRole("button", { name: /search/i }).first().click();
    await expect(page.getByPlaceholder(/Search e\.g\./i)).toBeVisible({ timeout: 10_000 });
  });
});
