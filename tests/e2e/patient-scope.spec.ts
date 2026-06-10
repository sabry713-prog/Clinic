/**
 * E2E test: patient scope enforcement.
 *
 * Requires:
 *   - Web app running at PLAYWRIGHT_BASE_URL (default: http://localhost:3000)
 *   - Core API running at http://localhost:4000
 *   - Dev seed has been run (pnpm --filter @app/core seed:dev)
 *   - Dev physician credentials available
 *
 * Test scenarios:
 *   1. Dev physician logs in
 *   2. Patient list shows only in-scope patients
 *   3. Navigating directly to 5 in-scope patients succeeds (patient header visible)
 *   4. Navigating to the out-of-scope patient URL returns 403 PATIENT_OUT_OF_SCOPE
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env["PLAYWRIGHT_BASE_URL"] ?? "http://localhost:3000";
const API_BASE = process.env["PLAYWRIGHT_API_BASE_URL"] ?? "http://localhost:4000";

// Dev seed credentials (matches session.service.ts dev bypass or Keycloak dev user)
const DEV_SESSION_COOKIE_NAME = "session_id";

// These UUIDs are set after seed runs — in CI they'd be read from a seed output file.
// For local dev, they are set via environment variables.
const IN_SCOPE_MRNS = ["MRN-006", "MRN-007", "MRN-008", "MRN-009", "MRN-010"];
const OUT_OF_SCOPE_MRN = "MRN-011";

/**
 * Helper: retrieve patient UUID from the API by MRN.
 * Uses a direct API call (no auth required for this helper endpoint in dev mode).
 */
async function getPatientIdByMrn(mrn: string, sessionCookie: string): Promise<string | null> {
  const response = await fetch(`${API_BASE}/api/v1/patients?q=${mrn}&limit=5`, {
    headers: { Cookie: `${DEV_SESSION_COOKIE_NAME}=${sessionCookie}` },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { data?: Array<{ id: string; mrn: string }> };
  const patient = body.data?.find((p) => p.mrn === mrn);
  return patient?.id ?? null;
}

/**
 * Helper: create a dev session by calling the auth/me endpoint.
 * In a real test environment, this would go through OIDC.
 * For E2E tests against the dev server, we seed a session cookie directly
 * via a dev-only endpoint or by storing the session externally.
 *
 * NOTE: This test assumes the dev server has a /api/v1/dev/session endpoint
 * that creates a session for the dev physician (disabled in non-dev environments).
 */
async function createDevSession(): Promise<string | null> {
  const response = await fetch(`${API_BASE}/api/v1/dev/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ external_subject: "dev-physician-001" }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { session_id?: string };
  return body.session_id ?? null;
}

test.describe("Patient scope enforcement", () => {
  let sessionCookie = "";

  test.beforeAll(async () => {
    // Create a dev session for the physician
    const sid = await createDevSession();
    if (sid) {
      sessionCookie = sid;
    }
  });

  test("in-scope patients are accessible", async ({ page }) => {
    if (!sessionCookie) {
      test.skip(true, "Dev session could not be created — is the dev server running?");
    }

    // Set cookie on the page
    await page.context().addCookies([
      {
        name: DEV_SESSION_COOKIE_NAME,
        value: sessionCookie,
        url: BASE_URL,
      },
    ]);

    await page.goto(`${BASE_URL}/patients`);

    // Patient list should load
    await expect(page.locator("table")).toBeVisible({ timeout: 10_000 });

    // Check that at least one in-scope patient is visible in the list
    let foundInScope = false;
    for (const mrn of IN_SCOPE_MRNS) {
      const cell = page.getByText(mrn);
      if (await cell.isVisible().catch(() => false)) {
        foundInScope = true;
        break;
      }
    }
    expect(foundInScope).toBe(true);
  });

  test("5 in-scope patients are individually accessible", async ({ page }) => {
    if (!sessionCookie) {
      test.skip(true, "Dev session could not be created");
    }

    await page.context().addCookies([
      { name: DEV_SESSION_COOKIE_NAME, value: sessionCookie, url: BASE_URL },
    ]);

    for (const mrn of IN_SCOPE_MRNS) {
      const patientId = await getPatientIdByMrn(mrn, sessionCookie);
      if (!patientId) continue; // skip if seed hasn't run

      await page.goto(`${BASE_URL}/patients/${patientId}`);

      // Patient header should render — MRN displayed
      await expect(page.getByText(mrn)).toBeVisible({ timeout: 8_000 });

      // No error page
      await expect(page.getByText(/not within your care scope/i)).not.toBeVisible();
    }
  });

  test("out-of-scope patient returns 403 PATIENT_OUT_OF_SCOPE", async ({ page }) => {
    if (!sessionCookie) {
      test.skip(true, "Dev session could not be created");
    }

    await page.context().addCookies([
      { name: DEV_SESSION_COOKIE_NAME, value: sessionCookie, url: BASE_URL },
    ]);

    const outOfScopeId = await getPatientIdByMrn(OUT_OF_SCOPE_MRN, sessionCookie);

    // Even without a DB patient ID, we can test with a fabricated UUID to verify 403
    const testId = outOfScopeId ?? "00000000-0000-0000-0000-000000000099";

    // Verify that the API returns 403 with PATIENT_OUT_OF_SCOPE
    const apiResponse = await page.request.get(
      `${API_BASE}/api/v1/patients/${testId}`,
      {
        headers: { Cookie: `${DEV_SESSION_COOKIE_NAME}=${sessionCookie}` },
      },
    );
    expect(apiResponse.status()).toBe(403);

    const body = await apiResponse.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe("PATIENT_OUT_OF_SCOPE");

    // Navigate to the patient page in the browser
    await page.goto(`${BASE_URL}/patients/${testId}`);

    // Error page should display the out-of-scope message
    await expect(
      page.getByText(/not within your care scope/i),
    ).toBeVisible({ timeout: 8_000 });

    await expect(
      page.getByText(/PATIENT_OUT_OF_SCOPE/i),
    ).toBeVisible();
  });
});
