import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
/**
 * PreAuthService — proxies the NPHIES engine (services/nphies-engine, Sprint 9).
 *
 * Same discipline as every other Python-service proxy in this app (ambient,
 * narrative, qa, ai-team): the browser never talks to a Python service directly,
 * so patient scope, RBAC, and audit logging always apply.
 *
 * Two surfaces:
 *   submitPreAuth()   one-shot POST that returns as soon as the work is QUEUED.
 *                     It deliberately does not wait for the payer -- the outcome
 *                     arrives on the stream below, which is what keeps the UI
 *                     responsive while a payer takes seconds to answer.
 *   streamStatus()    re-streams the engine's `nphies_status_updated` SSE events
 *                     as an RxJS Observable for NestJS's @Sse() decorator.
 */

import { Injectable, Inject, Logger, ServiceUnavailableException } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { Observable } from "rxjs";

export interface PreAuthSubmission {
  readonly encounter_id: string;
  readonly order_id: string;
  readonly icd10_code: string;
  readonly sbs_code: string;
  readonly clinical_document: string;
  readonly patient_civil_id?: string | undefined;
  readonly payer_id?: string | undefined;
  readonly icd10_display?: string | undefined;
  readonly sbs_display?: string | undefined;
}

export interface QueuedResult {
  readonly status: string;
  readonly encounter_id: string;
  readonly order_id?: string;
}

function unavailable(message: string): ServiceUnavailableException {
  return new ServiceUnavailableException({
    error: { code: "NPHIES_ENGINE_UNAVAILABLE", message },
  });
}

/** Parse one `event:`/`data:` SSE block into a NestJS MessageEvent. */
function parseSseBlock(block: string): MessageEvent | null {
  let eventType = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) eventType = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join("\n");
  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    // Not JSON -- forward the raw string rather than dropping the event.
  }
  return { type: eventType, data } as MessageEvent;
}

@Injectable()
export class PreAuthService {
  private readonly logger = new Logger(PreAuthService.name);
  private readonly engineUrl: string;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {
    this.engineUrl = process.env.NPHIES_ENGINE_URL ?? "http://127.0.0.1:5006";
  }

  /**
   * @param patientId The patient whose claim this pre-auth belongs to. Passed explicitly rather than
   *   read off the body: the URL owns the patient, and a body-supplied patient id is a value the
   *   caller could point at someone else's record.
   */
  async submitPreAuth(patientId: string, body: PreAuthSubmission): Promise<QueuedResult> {
    let response: Response;
    try {
      response = await fetch(`${this.engineUrl}/api/v1/nphies/prior-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      this.logger.error("nphies_engine_unreachable", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw unavailable("NPHIES engine is unreachable");
    }
    if (!response.ok) {
      this.logger.error("nphies_engine_error", { status: response.status });
      throw unavailable("NPHIES engine returned an error");
    }
    const queued = (await response.json()) as QueuedResult;

    // Record it. Without a row the payer's answer to "does this need authorization" is the only thing
    // that survives, so the gate can warn but never prevent a submission whose authorization is
    // outstanding. A failure here must not lose the submission the engine already accepted, so it is
    // logged and the queue result is still returned -- but it is never swallowed silently.
    try {
      await this.pool.query(
        `INSERT INTO app.nphies_preauth
           (patient_id, encounter_id, service_code, service_display, diagnosis_icd10,
            status, mode, engine_reference, response_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          patientId,
          body.encounter_id || null,
          body.sbs_code,
          body.sbs_display ?? null,
          body.icd10_code,
          queued.status,
          (queued as { mode?: string }).mode ?? "unknown",
          (queued as { id?: string }).id ?? null,
          queued,
        ],
      );
    } catch (err) {
      this.logger.error("preauth_record_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return queued;
  }

  /**
   * Notify the engine that an order or diagnosis landed on an active encounter,
   * so eligibility is checked ahead of the clinician reaching pre-auth.
   * Best-effort: a failure here must never break the write that triggered it.
   */
  async notifyEncounterActivity(
    encounterId: string,
    patientCivilId: string,
    payerId: string,
  ): Promise<void> {
    try {
      await fetch(`${this.engineUrl}/api/v1/nphies/encounter-activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encounter_id: encounterId,
          patient_civil_id: patientCivilId,
          payer_id: payerId,
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      this.logger.warn("nphies_encounter_activity_notify_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  streamStatus(encounterId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const controller = new AbortController();

      void (async () => {
        let response: Response;
        try {
          response = await fetch(
            `${this.engineUrl}/api/v1/nphies/stream?encounter_id=${encodeURIComponent(encounterId)}`,
            { signal: controller.signal },
          );
        } catch (err) {
          this.logger.error("nphies_stream_unreachable", {
            error: err instanceof Error ? err.message : String(err),
          });
          subscriber.error(unavailable("NPHIES engine is unreachable"));
          return;
        }

        if (!response.ok || !response.body) {
          subscriber.error(unavailable("NPHIES engine returned an error"));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let sepIndex = buffer.indexOf("\n\n");
            while (sepIndex !== -1) {
              const block = buffer.slice(0, sepIndex);
              buffer = buffer.slice(sepIndex + 2);
              const parsed = parseSseBlock(block);
              if (parsed) subscriber.next(parsed);
              sepIndex = buffer.indexOf("\n\n");
            }
          }
          subscriber.complete();
        } catch (err) {
          subscriber.error(err);
        } finally {
          reader.releaseLock();
        }
      })();

      return () => { controller.abort(); };
    });
  }
}
