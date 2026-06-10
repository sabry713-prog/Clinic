/**
 * FHIR client stub for Slice 0.
 * Real implementation (SMART on FHIR, oauth2, resource fetching) ships in Slice 1.
 */
export interface FhirClientConfig {
  readonly baseUrl: string;
  readonly authMode: "none" | "oauth2" | "smart";
  readonly accessToken?: string;
}

export interface FhirResource {
  readonly resourceType: string;
  readonly id: string;
  readonly [key: string]: unknown;
}

export interface FhirBundle<T extends FhirResource = FhirResource> {
  readonly resourceType: "Bundle";
  readonly total?: number;
  readonly entry?: ReadonlyArray<{ readonly resource?: T }>;
}

export class FhirClient {
  constructor(private readonly config: FhirClientConfig) {}

  async read<T extends FhirResource>(
    resourceType: string,
    id: string,
  ): Promise<T> {
    throw new Error(
      `FhirClient.read(${resourceType}/${id}) — stub not implemented. Implement in Slice 1.`,
    );
  }

  async search<T extends FhirResource>(
    resourceType: string,
    params: Record<string, string>,
  ): Promise<FhirBundle<T>> {
    throw new Error(
      `FhirClient.search(${resourceType}, ${JSON.stringify(params)}) — stub not implemented. Implement in Slice 1.`,
    );
  }
}

export function createFhirClient(config: FhirClientConfig): FhirClient {
  return new FhirClient(config);
}
