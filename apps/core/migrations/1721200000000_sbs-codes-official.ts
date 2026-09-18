import type { MigrationBuilder } from "node-pg-migrate";

// Replace the invented SBS suffixes with codes that exist in the published catalogue.
//
// The original map took each service's real SBS item+block root and appended a suffix that is
// not in the standard (the repo's own note describes the simplification). A claim carrying a
// code the standard does not contain is rejected on coding alone, so the codes had to come from
// CHI's SBS V2.0 list -- see tools/build_sbs_catalog.py and data/ontologies/_sources/.
//
// Each replacement below was verified present in that list, and each is the closest published
// match for the service: "Magnetic resonance imaging" resolves to the brain study because that
// is what the list carries at 90901-*, and "Urine examination (urinalysis)" to the automated
// urinalysis code.
//
// NOT fixed here, deliberately: CBC, thyroid function, mammography, biopsy, cardiac stress
// testing, faecal occult blood, flexible sigmoidoscopy, CT of a general body site, endoscopy of
// the upper GI tract, coagulation profile, and the troponin assays by name. Searches for those
// services in the published list returned either nothing or a different procedure, and inventing
// a code is the exact failure this migration exists to undo. They keep their current values and
// are unverified against SBS V2.0 -- curate them from the payer's own service catalogue before
// go-live. This is a recorded deferral with a trigger, not a dropped item.
const FIXES: readonly [string, string, string][] = [
  ["29303009", "11700-00-00", "Other electrocardiography [ecg]"],
  ["40701008", "55113-00-00", "M-mode and 2 dimensional real time ultrasound of heart"],
  ["113091000", "90901-00-10", "Magnetic resonance imaging of brain, without contrast medium"],
  ["399208008", "58500-00-10", "Radiography of chest, 1 view"],
  ["16310003", "55036-00-00", "Ultrasound of abdomen"],
  ["16298000", "73000-00-60", "Lipid profile"],
  ["302181000", "73000-00-10", "Basic metabolic panel"],
  ["26958001", "73000-00-90", "Liver function panel"],
  ["43396009", "73050-18-50", "Measurement of glycosylated hemoglobin (A1C)"],
  ["27171005", "73150-00-30", "Automated Urinalysis"],
  ["117010004", "73050-40-00", "Culture and sensitivity of aerobic bacteria in blood"],
  ["1988-5", "73100-11-40", "Measurement of C Reactive Protein"],
  ["312681000", "12306-00-00", "Bone densitometry using dual energy x-ray absorptiometry"],
  ["73761001", "32084-00-00", "Fibreoptic colonoscopy to hepatic flexure"],
  ["86184003", "11709-00-00", "Holter ambulatory continuous ECG recording"],
  ["54550000", "11003-00-00", "Electroencephalography of >= 3 hours duration"],
  ["23426006", "11503-05-00", "Spirometry with exercise testing"],
  ["1919006", "30473-00-00", "Panendoscopy to duodenum"],
];

export async function up(pgm: MigrationBuilder): Promise<void> {
  for (const [orderCode, sbsCode, sbsDisplay] of FIXES) {
    pgm.sql(`UPDATE app.order_sbs_map SET sbs_code = '${sbsCode}', sbs_display = '${sbsDisplay.replace(/'/g, "''")}' WHERE order_code = '${orderCode}'`);
    // Anything already coded against the old suffix follows, so an existing order and the map
    // agree. Existing rows keep their confirmed_by: this is a correction, not a re-confirmation.
    pgm.sql(`UPDATE app.service_request_sbs_coding SET sbs_code = '${sbsCode}', sbs_display = '${sbsDisplay.replace(/'/g, "''")}' WHERE order_code = '${orderCode}'`);
  }
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Not reversible: the previous values were not codes from the standard, and restoring them
  // would restore a rejection cause.
}
