import {
  Injectable,
  type NestMiddleware,
} from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { FeatureFlagsService } from "./feature-flags.service";

/**
 * Feature-flag middleware — "stop the bleed" mechanism.
 *
 * Checks the relevant feature flag before routing requests to Q&A, narrative,
 * or handoff. If a flag is disabled the middleware returns 503 immediately
 * with a structured JSON body. The LLM is never called.
 *
 * Flags checked:
 *   qa.allow_responses  — POST /api/v1/patients/*/qa
 *   narrative.enabled   — POST /api/v1/patients/*/narrative
 *   handoff.enabled     — POST /api/v1/handoff
 *
 * This is the first line of defence described in the SEV-1 playbook in
 * docs/ops/03-incident-response.md.
 */
@Injectable()
export class FeatureFlagsMiddleware implements NestMiddleware {
  constructor(private readonly flags: FeatureFlagsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const path = req.path;

    if (isQaPath(path) && !this.flags.isEnabled("qa.allow_responses")) {
      res.status(503).json({
        statusCode: 503,
        error: "ServiceUnavailable",
        message:
          "Q&A responses are temporarily disabled. " +
          "The system is operating in refusal-only mode. " +
          "Please contact your system administrator.",
        flag: "qa.allow_responses",
      });
      return;
    }

    if (isNarrativePath(path) && !this.flags.isEnabled("narrative.enabled")) {
      res.status(503).json({
        statusCode: 503,
        error: "ServiceUnavailable",
        message:
          "Narrative generation is temporarily disabled. " +
          "Please contact your system administrator.",
        flag: "narrative.enabled",
      });
      return;
    }

    if (isHandoffPath(path) && !this.flags.isEnabled("handoff.enabled")) {
      res.status(503).json({
        statusCode: 503,
        error: "ServiceUnavailable",
        message:
          "Handoff reports are temporarily disabled. " +
          "Please contact your system administrator.",
        flag: "handoff.enabled",
      });
      return;
    }

    next();
  }
}

function isQaPath(path: string): boolean {
  return /\/api\/v1\/patients\/[^/]+\/qa/.test(path);
}

function isNarrativePath(path: string): boolean {
  return /\/api\/v1\/patients\/[^/]+\/narrative/.test(path);
}

function isHandoffPath(path: string): boolean {
  return path.startsWith("/api/v1/handoff");
}
