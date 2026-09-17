/**
 * M05 — all-page traversal for the FHIR fetch.
 *
 * The ingestion service used to take the first page of each search and note the
 * gap in a comment, so a patient whose history spanned more than one page was
 * ingested in part, silently. The client already exported `getNextPageUrl` and
 * `fetchBundle`; nothing called them.
 *
 * These tests drive `fetchPatientResources` directly with a fake client, because
 * that method is where the traversal lives and no spec covered it.
 */
import { ConfigService } from "@nestjs/config";
import type { Pool } from "pg";
import type { FhirBundle } from "@clinical-copilot/fhir-client";

import { IngestionService } from "./ingestion.service";

const PATIENT_ID = "fhir-patient-1";

interface FakeClient {
  searchEncounters: jest.Mock;
  searchObservations: jest.Mock;
  searchConditions: jest.Mock;
  searchMedicationRequests: jest.Mock;
  searchAllergies: jest.Mock;
  searchDocumentReferences: jest.Mock;
  fetchBundle: jest.Mock;
}

function emptyBundle(overrides: Partial<FhirBundle<never>> = {}): FhirBundle<never> {
  return { resourceType: "Bundle", type: "searchset", entry: [], ...overrides } as FhirBundle<never>;
}

function encounterBundle(id: string, next?: string): FhirBundle<never> {
  return emptyBundle({
    entry: [
      {
        resource: {
          resourceType: "Encounter",
          id,
          status: "finished",
          class: { code: "AMB" },
          // mapEncounter returns null without a subject reference, so a fixture
          // missing this would make the traversal assertions pass vacuously
          subject: { reference: `Patient/${PATIENT_ID}` },
        } as never,
      },
    ],
    ...(next ? { link: [{ relation: "next", url: next }] } : {}),
  });
}

function makeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  return {
    searchEncounters: jest.fn().mockResolvedValue(emptyBundle()),
    searchObservations: jest.fn().mockResolvedValue(emptyBundle()),
    searchConditions: jest.fn().mockResolvedValue(emptyBundle()),
    searchMedicationRequests: jest.fn().mockResolvedValue(emptyBundle()),
    searchAllergies: jest.fn().mockResolvedValue(emptyBundle()),
    searchDocumentReferences: jest.fn().mockResolvedValue(emptyBundle()),
    fetchBundle: jest.fn(),
    ...overrides,
  };
}

function makeService(): IngestionService {
  const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool;
  const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
  return new IngestionService(pool, config);
}

/** The method under test is private; this is the seam. */
async function fetchResources(
  service: IngestionService,
  client: FakeClient,
): Promise<Awaited<ReturnType<IngestionService["fetchPatientResources"]>>> {
  return service["fetchPatientResources"](
    client as unknown as Parameters<IngestionService["fetchPatientResources"]>[0],
    PATIENT_ID,
    "hapi-sandbox",
  );
}

describe("IngestionService — all-page traversal (M05)", () => {
  it("follows the next link and ingests the later pages too", async () => {
    const client = makeClient({
      searchEncounters: jest
        .fn()
        .mockResolvedValue(encounterBundle("enc-1", "https://fhir.example/Encounter?page=2")),
      fetchBundle: jest.fn().mockResolvedValue(encounterBundle("enc-2")),
    });

    const result = await fetchResources(makeService(), client);

    expect(client.fetchBundle).toHaveBeenCalledWith("https://fhir.example/Encounter?page=2");
    expect(result.encounters).toHaveLength(2);
    expect(result.partial_failures).toEqual([]);
  });

  it("does not fetch a second page when the bundle offers no next link", async () => {
    const client = makeClient({
      searchEncounters: jest.fn().mockResolvedValue(encounterBundle("enc-1")),
    });

    const result = await fetchResources(makeService(), client);

    expect(client.fetchBundle).not.toHaveBeenCalled();
    expect(result.encounters).toHaveLength(1);
    expect(result.partial_failures).toEqual([]);
  });

  // The distinction that matters: a later page failing must not throw away the
  // pages that did arrive, and the run must be marked partial rather than clean.
  it("keeps the pages it already has when a later page fails, and reports partial", async () => {
    const client = makeClient({
      searchEncounters: jest
        .fn()
        .mockResolvedValue(encounterBundle("enc-1", "https://fhir.example/Encounter?page=2")),
      fetchBundle: jest.fn().mockRejectedValue(new Error("upstream 503")),
    });

    const result = await fetchResources(makeService(), client);

    expect(result.encounters).toHaveLength(1); // page 1 kept
    expect(result.partial_failures).toHaveLength(1);
    expect(result.partial_failures[0]).toContain("encounters");
    expect(result.partial_failures[0]).toContain("page 2");
  });

  it("stops at the page cap instead of following an endless next link", async () => {
    const client = makeClient({
      searchEncounters: jest
        .fn()
        .mockResolvedValue(encounterBundle("enc-1", "https://fhir.example/Encounter?page=2")),
      // every page offers another one
      fetchBundle: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(encounterBundle("enc-next", "https://fhir.example/Encounter?page=99")),
        ),
    });

    const result = await fetchResources(makeService(), client);

    expect(client.fetchBundle).toHaveBeenCalledTimes(49); // page 1 + 49 = the cap of 50
    expect(result.partial_failures.some((f) => f.includes("page limit"))).toBe(true);
  });
});
