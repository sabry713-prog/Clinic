/**
 * InterpreterService
 *
 * Proxies ad-hoc clinician<->patient communication translation to the
 * Python narrative service. This is a communication aid, not a record
 * summarizer: it does not read the patient record, and the source text
 * is whatever short message the caller supplies (a clinician's
 * explanation/instruction, or a patient's words relayed by staff).
 *
 * Not persisted or cached -- translated fresh on each request, same as
 * the patient-recap endpoint.
 */

import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

export interface TranslateMessageResult {
  readonly text: string | null;
  readonly fallback_message: string | null;
  readonly prompt_template_version: string;
  readonly blocklist_triggered: boolean;
  readonly disclaimer: string;
}

const DISCLAIMER =
  "Machine translation for bedside communication. Not a clinical interpretation. For urgent or complex conversations, use a qualified human interpreter.";

@Injectable()
export class InterpreterService {
  private readonly logger = new Logger(InterpreterService.name);
  private readonly narrativeServiceUrl: string;

  constructor() {
    this.narrativeServiceUrl =
      process.env["NARRATIVE_SERVICE_URL"] ?? "http://localhost:5001";
  }

  async translate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<TranslateMessageResult> {
    const res = await fetch(`${this.narrativeServiceUrl}/narrative/interpret`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        source_language: sourceLanguage,
        target_language: targetLanguage,
      }),
    }).catch((err: unknown) => {
      this.logger.error("interpreter_service_unreachable", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new ServiceUnavailableException({
        error: { code: "NARRATIVE_SERVICE_UNAVAILABLE", message: "Narrative service is unreachable" },
      });
    });

    if (!res.ok) {
      throw new ServiceUnavailableException({
        error: { code: "NARRATIVE_SERVICE_UNAVAILABLE", message: "Narrative service returned an error" },
      });
    }

    const body = (await res.json()) as {
      text: string | null;
      fallback_message: string | null;
      prompt_template_version: string;
      blocklist_triggered: boolean;
    };

    return { ...body, disclaimer: DISCLAIMER };
  }
}
