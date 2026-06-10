/**
 * Handoff formatter — assembles structured sections into plain text.
 *
 * Constraints:
 * - No interpretive language
 * - Values stated verbatim
 * - No H/L flags, no "elevated", no "worsening"
 * - Reference ranges shown as [low–high unit] if present
 */

export interface HandoffSections {
  readonly identity_and_admission: readonly string[];
  readonly documented_today: readonly string[];
  readonly current_medications: readonly string[];
  readonly recent_vitals: readonly string[];
  readonly recent_labs: readonly string[];
  readonly pending_orders: readonly string[];
}

export interface ProvenanceItem {
  readonly section: string;
  readonly row_index: number;
  readonly source_type: string;
  readonly source_id: string;
  readonly field: string;
}

export function formatSection(title: string, items: readonly string[]): string {
  if (items.length === 0) {
    return `### ${title}\n(None documented)\n`;
  }
  const lines = items.map((item) => `- ${item}`).join("\n");
  return `### ${title}\n${lines}\n`;
}

export function formatHandoffText(sections: HandoffSections): string {
  const parts: string[] = [
    formatSection("Identity and Admission", sections.identity_and_admission),
    formatSection("Documented Today", sections.documented_today),
    formatSection("Current Medications", sections.current_medications),
    formatSection("Recent Vitals", sections.recent_vitals),
    formatSection("Recent Labs", sections.recent_labs),
    formatSection("Pending Orders", sections.pending_orders),
  ];
  return parts.join("\n");
}
