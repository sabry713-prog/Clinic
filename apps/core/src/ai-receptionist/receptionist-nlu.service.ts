/**
 * ReceptionistNluService — free-text -> department/appointment-type matching
 * for the AI Receptionist self-service booking flow
 * (docs/architecture/ai-receptionist.md).
 *
 * Structural mirror of matchCatalog() in service-request.service.ts: a
 * small hardcoded catalog matched against literal DEPARTMENT/APPOINTMENT-
 * TYPE NAME terms only -- never symptom vocabulary. A patient typing a
 * symptom ("my chest hurts") must produce NO department match; the frontend
 * falls back to a structured picker rather than guessing. This is the
 * CLAUDE.md §2 boundary for this feature: no dictionary of symptom->
 * department is ever built, even informally, since that would be
 * triage/routing-by-symptom. Pure function, no I/O, no LLM call.
 */
import { Injectable } from "@nestjs/common";

interface CatalogEntry {
  readonly re: RegExp;
  readonly value: string;
}

// Deliberately small (v1 trim) -- expanding this list later is a config
// change, not an architecture change.
const DEPARTMENTS: readonly CatalogEntry[] = [
  { re: /\bcardiology\b|\bheart clinic\b/i, value: "Cardiology" },
  { re: /\bdermatology\b|\bskin clinic\b/i, value: "Dermatology" },
  { re: /\borthop(?:a|e)dics?\b/i, value: "Orthopedics" },
  { re: /\bp(?:a|e)diatrics\b|\bchildren'?s clinic\b/i, value: "Pediatrics" },
  { re: /\binternal medicine\b|\bgeneral medicine\b/i, value: "Internal Medicine" },
  { re: /\bent\b|\bear,? nose,? (?:and|&) throat\b/i, value: "ENT" },
  { re: /\bobstetrics\b|\bgyn(?:a)?ecology\b|\bob-?gyn\b/i, value: "Obstetrics & Gynecology" },
];

const APPOINTMENT_TYPES: readonly CatalogEntry[] = [
  { re: /\bfollow-?up\b/i, value: "follow_up" },
  { re: /\bnew patient\b|\bfirst visit\b/i, value: "new_patient" },
  { re: /\bconsult(?:ation)?\b/i, value: "consultation" },
  { re: /\bprocedure\b/i, value: "procedure" },
];

export interface NluMatchResult {
  readonly departmentDisplay: string | null;
  readonly appointmentType: string | null;
  readonly confident: boolean;
}

@Injectable()
export class ReceptionistNluService {
  match(text: string): NluMatchResult {
    const deptMatches = this.matchAll(DEPARTMENTS, text);
    const typeMatches = this.matchAll(APPOINTMENT_TYPES, text);

    return {
      departmentDisplay: deptMatches.size === 1 ? [...deptMatches][0]! : null,
      appointmentType: typeMatches.size === 1 ? [...typeMatches][0]! : null,
      // Ambiguity (more than one competing candidate) is the only thing
      // that makes this "not confident" -- zero matches is a normal,
      // confident "nothing recognized" outcome, not an error.
      confident: deptMatches.size <= 1 && typeMatches.size <= 1,
    };
  }

  private matchAll(catalog: readonly CatalogEntry[], text: string): Set<string> {
    const matches = new Set<string>();
    for (const entry of catalog) {
      if (entry.re.test(text)) matches.add(entry.value);
    }
    return matches;
  }
}
