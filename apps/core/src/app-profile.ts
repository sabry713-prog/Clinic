/**
 * Deployment-profile switch for apps/core module composition (E3).
 *
 * Two profiles, one codebase -- a config switch, not a fork:
 *
 * - "clinical" (default): every module loads, including the clinical agents
 *   (Scribe/Consultant/Pharmacist via ai-team, ambient scribe, narrative,
 *   Q&A, interpreter, handoff, drafts, ai-receptionist).
 * - "claim-integrity": the SaMD-free administrative surface only -- claim
 *   readiness, coding, rejection risk, pre-auth, and the claim simulator /
 *   coder queue. The clinical agents above are NOT loaded, so nothing in that
 *   profile generates, interprets, or restates clinical content
 *   (CLAUDE.md §2). This is the fastest revenue path that carries no SaMD
 *   classification risk: pure billing-paperwork integrity.
 *
 * app.module.ts composes its imports from this list; health.controller.ts
 * reports the active profile and the loaded module names so the composition
 * is verifiable at runtime, not just in code review.
 */

export type AppProfile = "clinical" | "claim-integrity";

export const APP_PROFILE_ENV = "APP_PROFILE";

/** Modules that mount LLM-driven or clinical-agent surfaces. Excluded from
 * the imports array when the claim-integrity profile is active. */
export const CLINICAL_AGENT_MODULE_NAMES = [
  "NarrativeProxyModule",
  "QAProxyModule",
  "InterpreterModule",
  "AmbientModule",
  "AiTeamModule",
  "HandoffModule",
  "DraftModule",
  "AiReceptionistModule",
] as const;

/** Every feature module app.module.ts can load, in a stable order. The order
 * doubles as the /health module list, so keep it alphabetical within
 * "always-on" then "clinical-agent" groups. */
export const FEATURE_MODULE_NAMES = [
  "DatabaseModule",
  "HealthModule",
  "AuthModule",
  "RbacModule",
  "PatientModule",
  "IngestionModule",
  "AdminModule",
  "ConditionModule",
  "ServiceRequestModule",
  "NphiesModule",
  "ClaimIntegrityModule",
  "RefillRequestModule",
  "HisConnectorModule",
  "PatientEngagementModule",
  "DsrModule",
  "MetricsModule",
  "FeatureFlagsModule",
  ...CLINICAL_AGENT_MODULE_NAMES,
] as const;

export function parseAppProfile(raw: string | undefined): AppProfile {
  return raw === "claim-integrity" ? "claim-integrity" : "clinical";
}

export function appProfile(): AppProfile {
  return parseAppProfile(process.env[APP_PROFILE_ENV]);
}

/** Names of the feature modules actually loaded under the active profile.
 * Mirrors exactly what app.module.ts imports (see composeFeatureModules). */
export function activeModuleNames(): readonly string[] {
  const profile = appProfile();
  const excluded =
    profile === "claim-integrity" ? new Set<string>(CLINICAL_AGENT_MODULE_NAMES) : new Set<string>();
  return FEATURE_MODULE_NAMES.filter((name) => !excluded.has(name));
}

/** True when the clinical agents (Scribe/Consultant/Pharmacist and the other
 * generative clinical surfaces) are loaded in this process. */
export function clinicalAgentsLoaded(): boolean {
  return appProfile() === "clinical";
}
