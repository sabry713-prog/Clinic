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
}
