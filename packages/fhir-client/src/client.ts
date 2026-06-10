import type {
  FhirBundle,
  FhirPatient,
  FhirEncounter,
  FhirObservation,
  FhirAllergyIntolerance,
  FhirCondition,
  FhirMedicationRequest,
  FhirDocumentReference,
  FhirResource,
} from "./types";
import { type AuthConfig, OAuth2TokenProvider } from "./auth";
import { iteratePages } from "./pagination";

export interface FhirClientConfig {
  readonly baseUrl: string;
  readonly auth: AuthConfig;
  /** Max retries on transient errors (default: 3) */
  readonly maxRetries?: number;
  /** Circuit breaker: consecutive failure threshold (default: 5) */
  readonly circuitBreakerThreshold?: number;
  /** Circuit breaker: reset window ms (default: 30_000) */
  readonly circuitBreakerResetMs?: number;
}

type SearchParams = Readonly<Record<string, string | readonly string[]>>;

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransient(status: number): boolean {
  return status === 429 || status === 503 || status === 502 || status === 504;
}

export class FhirRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = "FhirRequestError";
  }
}

export class FhirCircuitOpenError extends Error {
  constructor() {
    super("FHIR client circuit breaker is open — upstream is unavailable");
    this.name = "FhirCircuitOpenError";
  }
}

export class FhirClient {
  private readonly tokenProvider: OAuth2TokenProvider | null;
  private readonly maxRetries: number;
  private readonly cbThreshold: number;
  private readonly cbResetMs: number;

  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(private readonly config: FhirClientConfig) {
    this.maxRetries = config.maxRetries ?? 3;
    this.cbThreshold = config.circuitBreakerThreshold ?? 5;
    this.cbResetMs = config.circuitBreakerResetMs ?? 30_000;

    if (
      config.auth.mode === "oauth2" &&
      config.auth.oauth2 !== undefined
    ) {
      this.tokenProvider = new OAuth2TokenProvider(config.auth.oauth2);
    } else {
      this.tokenProvider = null;
    }
  }

  // ─── Public resource methods ────────────────────────────────────────────────

  async getPatient(id: string): Promise<FhirPatient> {
    return this.get<FhirPatient>(`Patient/${id}`);
  }

  async searchPatients(params: SearchParams): Promise<FhirBundle<FhirPatient>> {
    return this.search<FhirPatient>("Patient", params);
  }

  async searchEncounters(
    params: SearchParams,
  ): Promise<FhirBundle<FhirEncounter>> {
    return this.search<FhirEncounter>("Encounter", params);
  }

  async searchObservations(
    params: SearchParams,
  ): Promise<FhirBundle<FhirObservation>> {
    return this.search<FhirObservation>("Observation", params);
  }

  async searchConditions(
    params: SearchParams,
  ): Promise<FhirBundle<FhirCondition>> {
    return this.search<FhirCondition>("Condition", params);
  }

  async searchMedicationRequests(
    params: SearchParams,
  ): Promise<FhirBundle<FhirMedicationRequest>> {
    return this.search<FhirMedicationRequest>("MedicationRequest", params);
  }

  async searchAllergies(
    params: SearchParams,
  ): Promise<FhirBundle<FhirAllergyIntolerance>> {
    return this.search<FhirAllergyIntolerance>("AllergyIntolerance", params);
  }

  async searchDocumentReferences(
    params: SearchParams,
  ): Promise<FhirBundle<FhirDocumentReference>> {
    return this.search<FhirDocumentReference>("DocumentReference", params);
  }

  /**
   * Iterate all patients matching params across all pages.
   */
  iteratePatients(
    params: SearchParams,
  ): AsyncGenerator<FhirPatient> {
    const url = this.buildUrl("Patient", params);
    return iteratePages<FhirPatient>(url, (u) => this.fetchBundle<FhirPatient>(u));
  }

  /**
   * Iterate all encounters matching params across all pages.
   */
  iterateEncounters(
    params: SearchParams,
  ): AsyncGenerator<FhirEncounter> {
    const url = this.buildUrl("Encounter", params);
    return iteratePages<FhirEncounter>(url, (u) => this.fetchBundle<FhirEncounter>(u));
  }

  /**
   * Generic paginated iterator for any resource type.
   */
  iterate<T extends FhirResource>(
    resourceType: string,
    params: SearchParams,
  ): AsyncGenerator<T> {
    const url = this.buildUrl(resourceType, params);
    return iteratePages<T>(url, (u) => this.fetchBundle<T>(u));
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async get<T extends FhirResource>(path: string): Promise<T> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/${path}`;
    return this.fetchWithRetry<T>(url);
  }

  private async search<T extends FhirResource>(
    resourceType: string,
    params: SearchParams,
  ): Promise<FhirBundle<T>> {
    const url = this.buildUrl(resourceType, params);
    return this.fetchBundle<T>(url);
  }

  private buildUrl(resourceType: string, params: SearchParams): string {
    const base = this.config.baseUrl.replace(/\/$/, "");
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (const v of value as readonly string[]) {
          query.append(key, v);
        }
      } else {
        query.set(key, value as string);
      }
    }
    const qs = query.toString();
    return qs ? `${base}/${resourceType}?${qs}` : `${base}/${resourceType}`;
  }

  async fetchBundle<T extends FhirResource>(url: string): Promise<FhirBundle<T>> {
    return this.fetchWithRetry<FhirBundle<T>>(url);
  }

  private async fetchWithRetry<T>(url: string): Promise<T> {
    if (Date.now() < this.circuitOpenUntil) {
      throw new FhirCircuitOpenError();
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? 4_000;
        await sleep(delay);
      }

      try {
        const result = await this.doFetch<T>(url);
        this.consecutiveFailures = 0;
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (
          err instanceof FhirRequestError &&
          !isTransient(err.status)
        ) {
          // Non-transient HTTP error — don't retry
          this.recordFailure();
          throw err;
        }

        this.recordFailure();

        if (Date.now() < this.circuitOpenUntil) {
          throw new FhirCircuitOpenError();
        }
      }
    }

    throw lastError ?? new Error("FHIR request failed after retries");
  }

  private async doFetch<T>(url: string): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/fhir+json",
    };

    if (this.tokenProvider !== null) {
      const token = await this.tokenProvider.getToken();
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new FhirRequestError(
        res.status,
        url,
        `FHIR request failed: ${res.status} ${text.slice(0, 200)}`,
      );
    }

    return res.json() as Promise<T>;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.cbThreshold) {
      this.circuitOpenUntil = Date.now() + this.cbResetMs;
      this.consecutiveFailures = 0;
    }
  }
}
