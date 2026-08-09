/**
 * AmbientService
 *
 * Proxies ambient-capture transcript segmentation to the Python transcription
 * service (docs/prompts/ambient-segmentation-prompt.md). Does not read the
 * patient record and does not persist anything -- the transcript is whatever
 * the clinician just recorded and confirmed; segmentation output is a
 * proposal the clinician reviews before it becomes a draft (draft.service.ts
 * re-validates every section server-side regardless of what this returns).
 */

import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

export interface SectionSpecInput {
  readonly key: string;
  readonly title: string;
}

export interface SegmentResult {
  readonly sections: ReadonlyArray<{ key: string; text: string }>;
  readonly unclassified_text: string;
  readonly retries: number;
}

export interface CondenseResult {
  readonly text: string;
  readonly condensed: boolean;
  readonly retries: number;
}

export interface ExtractedTerm {
  readonly term: string;
  readonly category: string;
}

export interface ExtractTermsResult {
  readonly terms: ReadonlyArray<ExtractedTerm>;
  readonly retries: number;
}

@Injectable()
export class AmbientService {
  private readonly logger = new Logger(AmbientService.name);
  private readonly transcriptionServiceUrl: string;

  constructor() {
    this.transcriptionServiceUrl =
      process.env["TRANSCRIPTION_SERVICE_URL"] ?? "http://127.0.0.1:5003";
  }

  async segment(
    text: string,
    sections: readonly SectionSpecInput[],
    language: string,
  ): Promise<SegmentResult> {
    const res = await fetch(`${this.transcriptionServiceUrl}/segment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, sections, language }),
    }).catch((err: unknown) => {
      this.logger.error("ambient_service_unreachable", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new ServiceUnavailableException({
        error: { code: "TRANSCRIPTION_SERVICE_UNAVAILABLE", message: "Transcription service is unreachable" },
      });
    });

    if (!res.ok) {
      throw new ServiceUnavailableException({
        error: { code: "TRANSCRIPTION_SERVICE_UNAVAILABLE", message: "Transcription service returned an error" },
      });
    }

    return (await res.json()) as SegmentResult;
  }

  /**
   * Lightly condenses ONE non-judgment section (chief_complaint/history --
   * enforced server-side in condense.py's CONDENSABLE_SECTIONS, never
   * client-configurable). Proposal only -- the clinician must explicitly
   * accept it, and draft.service.ts re-validates independently via
   * validateCondensation() at draft-creation time regardless of what this
   * returns (docs/prompts/ambient-condensation-prompt.md).
   */
  async condense(sectionKey: string, text: string, language: string): Promise<CondenseResult> {
    const res = await fetch(`${this.transcriptionServiceUrl}/condense`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section_key: sectionKey, text, language }),
    }).catch((err: unknown) => {
      this.logger.error("ambient_service_unreachable", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new ServiceUnavailableException({
        error: { code: "TRANSCRIPTION_SERVICE_UNAVAILABLE", message: "Transcription service is unreachable" },
      });
    });

    if (!res.ok) {
      throw new ServiceUnavailableException({
        error: { code: "TRANSCRIPTION_SERVICE_UNAVAILABLE", message: "Transcription service returned an error" },
      });
    }

    return (await res.json()) as CondenseResult;
  }

  /**
   * Validation-only re-check (no generation) -- called by draft.service.ts
   * server-side at draft-creation time to independently verify a condensed
   * section, never trusting a client-supplied "this passed" claim.
   */
  async validateCondensation(condensedText: string, sourceText: string, language: string): Promise<boolean> {
    const res = await fetch(`${this.transcriptionServiceUrl}/validate-condensation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ condensed_text: condensedText, source_text: sourceText, language }),
    }).catch((err: unknown) => {
      this.logger.error("ambient_service_unreachable", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new ServiceUnavailableException({
        error: { code: "TRANSCRIPTION_SERVICE_UNAVAILABLE", message: "Transcription service is unreachable" },
      });
    });

    if (!res.ok) {
      throw new ServiceUnavailableException({
        error: { code: "TRANSCRIPTION_SERVICE_UNAVAILABLE", message: "Transcription service returned an error" },
      });
    }

    const body = (await res.json()) as { valid: boolean };
    return body.valid;
  }

  /**
   * Points out medical terminology already present in a dictation transcript
   * -- reference-only output for the clinician to read alongside the raw
   * transcript, never submitted into a draft (unlike segment/condense, this
   * has no *_keys flag threaded into draft.service.ts because there is
   * nothing here to re-verify at draft-creation time -- see
   * docs/prompts/ambient-term-extraction-prompt.md).
   */
  async extractTerms(text: string, language: string): Promise<ExtractTermsResult> {
    const res = await fetch(`${this.transcriptionServiceUrl}/extract-terms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language }),
    }).catch((err: unknown) => {
      this.logger.error("ambient_service_unreachable", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new ServiceUnavailableException({
        error: { code: "TRANSCRIPTION_SERVICE_UNAVAILABLE", message: "Transcription service is unreachable" },
      });
    });

    if (!res.ok) {
      throw new ServiceUnavailableException({
        error: { code: "TRANSCRIPTION_SERVICE_UNAVAILABLE", message: "Transcription service returned an error" },
      });
    }

    return (await res.json()) as ExtractTermsResult;
  }
}
