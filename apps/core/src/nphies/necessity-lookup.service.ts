import { Injectable } from "@nestjs/common";

/**
 * Asks the payer's necessity rules whether a service is justified by a diagnosis, and whether it
 * needs pre-authorization.
 *
 * Extracted from ServiceRequestService, where it was a private method on a module that does not
 * export its provider -- so the submission gate could not ask the same question the ordering step
 * asks. Copying the call would have given the project two answers to one question, free to drift
 * apart; this service has no dependencies, so anything that needs the payer's view can inject it.
 *
 * Returns null when the rules cannot be reached. Callers MUST keep "could not reach the rules"
 * distinct from "no rule says this is justified" -- collapsing them reports an unreachable service
 * as a clinical judgement.
 */
export interface NecessityVerdict {
  readonly status: "GREEN" | "YELLOW" | "RED";
  readonly pre_auth_required: boolean | null;
  readonly suggested_codes: { icd10: string; description: string }[];
}

@Injectable()
export class NecessityLookupService {
  private readonly graphUrl: string;

  constructor() {
    this.graphUrl = process.env.GRAPH_SERVICE_URL ?? "http://127.0.0.1:5004";
  }

  async lookup(icd10Code: string, sbsCode: string): Promise<NecessityVerdict | null> {
    try {
      const response = await fetch(`${this.graphUrl}/api/v1/nphies/validate-necessity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icd10_code: icd10Code, service_or_drug_code: sbsCode }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        status?: string;
        pre_auth_required?: boolean;
        suggested_codes?: { icd10: string; description: string }[];
      };
      if (body.status !== "GREEN" && body.status !== "YELLOW" && body.status !== "RED") return null;
      return {
        status: body.status,
        pre_auth_required: body.pre_auth_required ?? null,
        suggested_codes: body.suggested_codes ?? [],
      };
    } catch {
      return null;
    }
  }
}
