/**
 * Which patient-page view is on screen, resolved in ONE place.
 *
 * The page and the sidebar each resolved this independently once, and disagreed: with no ?view= the
 * page rendered the Journey while the sidebar lit up Copilot. Nothing failed loudly -- the wrong row
 * was highlighted -- so the only way to catch it was to look at the app. Both now call this.
 */
export type PatientViewId = "journey" | "workspace" | "chart" | "encounter";

export const PATIENT_VIEW_DEFAULT: PatientViewId = "journey";

export function resolveCurrentView(
  onPatientPage: boolean,
  viewParam: string | null,
): PatientViewId | null {
  if (!onPatientPage) return null;
  switch (viewParam) {
    case "chart":
    case "workspace":
    case "encounter":
    case "journey":
      return viewParam;
    default:
      return PATIENT_VIEW_DEFAULT;
  }
}
