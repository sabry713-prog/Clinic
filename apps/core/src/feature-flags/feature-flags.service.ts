import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Feature flags for Clinical Copilot.
 *
 * Flags are backed by environment variables (set per-environment via ConfigMap
 * in Kubernetes, or in .env for local dev). In production they can be toggled
 * by updating the ConfigMap and rolling the deployment -- no code change needed.
 *
 * The most important flag is `qa.allow_responses`: setting it to false puts
 * Q&A into refusal-only mode as the SEV-1 "stop the bleed" mechanism
 * described in docs/ops/03-incident-response.md.
 */

export interface FeatureFlags {
  /** If false, all Q&A requests return a refusal without calling the LLM */
  "qa.allow_responses": boolean;
  /** If false, narrative endpoint returns 503 */
  "narrative.enabled": boolean;
  /** If false, handoff endpoint returns 503 */
  "handoff.enabled": boolean;
  /** If false, ingestion scheduler is paused */
  "ingestion.enabled": boolean;
}

type FlagKey = keyof FeatureFlags;

const ENV_KEY_MAP: Record<FlagKey, string> = {
  "qa.allow_responses": "FEATURE_FLAG_QA_ALLOW_RESPONSES",
  "narrative.enabled": "FEATURE_FLAG_NARRATIVE_ENABLED",
  "handoff.enabled": "FEATURE_FLAG_HANDOFF_ENABLED",
  "ingestion.enabled": "FEATURE_FLAG_INGESTION_ENABLED",
};

const DEFAULTS: FeatureFlags = {
  "qa.allow_responses": true,
  "narrative.enabled": true,
  "handoff.enabled": true,
  "ingestion.enabled": true,
};

@Injectable()
export class FeatureFlagsService {
  constructor(private readonly config: ConfigService) {}

  isEnabled(flag: FlagKey): boolean {
    const envKey = ENV_KEY_MAP[flag];
    const raw = this.config.get<string>(envKey);
    if (raw === undefined || raw === null) {
      return DEFAULTS[flag];
    }
    // Accept "false" or "0" as false; everything else (including "true", "1") as true
    return raw.toLowerCase() !== "false" && raw !== "0";
  }

  /**
   * Return all flag values as a plain object (for the admin config endpoint).
   */
  getAllFlags(): FeatureFlags {
    return {
      "qa.allow_responses": this.isEnabled("qa.allow_responses"),
      "narrative.enabled": this.isEnabled("narrative.enabled"),
      "handoff.enabled": this.isEnabled("handoff.enabled"),
      "ingestion.enabled": this.isEnabled("ingestion.enabled"),
    };
  }
}
