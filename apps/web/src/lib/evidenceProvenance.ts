/**
 * Reference-map provenance chains for coding suggestions (S4.1 cutaway).
 *
 * ICD-10-AM and SBS suggestions are NOT graph-derived — they are deterministic
 * Postgres reference-table lookups (app.snomed_icd10am_map /
 * app.order_sbs_map, via apps/core's icd-coding.service.ts /
 * sbs-coding.service.ts). Their cutaway therefore carries the exact SQL the
 * service executes (with the row's own values as the bound parameters) and is
 * labeled "SQL executed" — honestly distinguished from the Cypher-backed
 * graph chains, never dressed up as a graph query.
 */

import type { EvidenceChain } from "../hooks/useAgentOrchestrator";

function buildChain(
  steps: { node_type: string; properties: Record<string, unknown> }[],
  sql: string,
): EvidenceChain {
  const rendered = steps
    .map((s) => {
      const props = Object.entries(s.properties)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(", ");
      return props ? `${s.node_type}(${props})` : s.node_type;
    })
    .join(" -> ");
  return { steps, rendered, cypher: [sql] };
}

/** Provenance for one ICD-10-AM suggestion row. Mirrors icd-coding.service.ts's
 * status query. Returns null when there is no suggestion (nothing to show —
 * "no mapping" is stated in the row itself, not as a fake trail). */
export function icdSuggestionChain(row: {
  readonly condition_id: string;
  readonly condition_display: string | null;
  readonly snomed_code: string | null;
  readonly suggestion: { readonly icd10am_code: string; readonly icd10am_display: string } | null;
}): EvidenceChain | null {
  if (row.suggestion === null) return null;
  const snomed = row.snomed_code ?? "—";
  return buildChain(
    [
      { node_type: "Condition", properties: { snomed_code: snomed, display: row.condition_display ?? "—" } },
      { node_type: "ReferenceMap", properties: { table: "app.snomed_icd10am_map", snomed_code: snomed } },
      { node_type: "Icd10am", properties: { code: row.suggestion.icd10am_code, display: row.suggestion.icd10am_display } },
    ],
    [
      "-- apps/core icd-coding.service.ts (deterministic reference-map lookup, no model)",
      "SELECT m.icd10am_code, m.icd10am_display",
      "FROM hospital.condition c",
      "LEFT JOIN app.snomed_icd10am_map m ON m.snomed_code = c.code",
      "WHERE c.patient_id = $1 AND c.status = 'active'",
      `-- bound for this row: snomed_code = '${snomed}' -> icd10am_code = '${row.suggestion.icd10am_code}'`,
    ].join("\n"),
  );
}

/** Provenance for one SBS suggestion row. Mirrors sbs-coding.service.ts. */
export function sbsSuggestionChain(row: {
  readonly service_request_id: string;
  readonly order_display: string;
  readonly order_code: string | null;
  readonly suggestion: { readonly sbs_code: string; readonly sbs_display: string } | null;
}): EvidenceChain | null {
  if (row.suggestion === null) return null;
  const orderCode = row.order_code ?? "—";
  return buildChain(
    [
      { node_type: "Order", properties: { code: orderCode, display: row.order_display } },
      { node_type: "ReferenceMap", properties: { table: "app.order_sbs_map", order_code: orderCode } },
      { node_type: "Sbs", properties: { code: row.suggestion.sbs_code, display: row.suggestion.sbs_display } },
    ],
    [
      "-- apps/core sbs-coding.service.ts (deterministic reference-map lookup, no model)",
      "SELECT m.sbs_code, m.sbs_display",
      "FROM app.service_request sr",
      "LEFT JOIN app.order_sbs_map m ON m.order_code = sr.code",
      "WHERE sr.patient_id = $1 AND sr.status = 'active'",
      `-- bound for this row: order_code = '${orderCode}' -> sbs_code = '${row.suggestion.sbs_code}'`,
    ].join("\n"),
  );
}
