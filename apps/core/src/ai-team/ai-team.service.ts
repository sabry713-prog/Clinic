/**
 * AiTeamService
 *
 * Proxies the AI Team agent stream (Pharmacist/Consultant/NPHIES,
 * services/orchestrator/agent_handlers.py, Sprint 8) to the browser.
 *
 * Re-streams the orchestrator's SSE response as an RxJS Observable for
 * NestJS's @Sse() decorator -- the same "core proxies every Python service,
 * the browser never talks to one directly" discipline as every other
 * AI-touching feature this session (ambient, narrative, qa, interpreter),
 * now extended to a streaming response instead of a single JSON one.
 */

import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { Observable } from "rxjs";

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
    // Not JSON -- forward the raw string as-is rather than dropping the event.
  }
  return { type: eventType, data } as MessageEvent;
}

@Injectable()
export class AiTeamService {
  private readonly logger = new Logger(AiTeamService.name);
  private readonly orchestratorUrl: string;

  constructor() {
    this.orchestratorUrl = process.env["ORCHESTRATOR_SERVICE_URL"] ?? "http://127.0.0.1:5005";
  }

  streamAgents(patientId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const controller = new AbortController();

      void (async () => {
        let response: Response;
        try {
          response = await fetch(
            `${this.orchestratorUrl}/api/v1/agents/stream?patient_id=${encodeURIComponent(patientId)}`,
            { signal: controller.signal },
          );
        } catch (err) {
          this.logger.error("ai_team_orchestrator_unreachable", {
            error: err instanceof Error ? err.message : String(err),
          });
          subscriber.error(
            new ServiceUnavailableException({
              error: { code: "ORCHESTRATOR_SERVICE_UNAVAILABLE", message: "Agent orchestrator is unreachable" },
            }),
          );
          return;
        }

        if (!response.ok || !response.body) {
          subscriber.error(
            new ServiceUnavailableException({
              error: { code: "ORCHESTRATOR_SERVICE_UNAVAILABLE", message: "Agent orchestrator returned an error" },
            }),
          );
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

      return () => controller.abort();
    });
  }

  /**
   * POST-proxy helper for the orchestrator's non-streaming agent endpoints.
   * Same failure contract as streamAgents: an unreachable or erroring
   * orchestrator surfaces as ORCHESTRATOR_SERVICE_UNAVAILABLE rather than
   * leaking a raw fetch error to the browser.
   */
  private async postToOrchestrator<T>(path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.orchestratorUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      this.logger.error("ai_team_orchestrator_unreachable", {
        path,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new ServiceUnavailableException({
        error: { code: "ORCHESTRATOR_SERVICE_UNAVAILABLE", message: "Agent orchestrator is unreachable" },
      });
    }
    if (!response.ok) {
      this.logger.error("ai_team_orchestrator_error", { path, status: response.status });
      throw new ServiceUnavailableException({
        error: { code: "ORCHESTRATOR_SERVICE_UNAVAILABLE", message: "Agent orchestrator returned an error" },
      });
    }
    return (await response.json()) as T;
  }

  /**
   * Run the inter-agent handoff chain (Sprint 10) for one patient:
   * NSCRE critical finding -> Consultant -> Pharmacist -> NPHIES -> Scribe.
   *
   * Returns an empty `handoffs` array when the graph reports no critical
   * finding -- agents are never invited to manufacture an escalation.
   */
  async runHandoffChain(patientId: string): Promise<{ patient_id: string; handoffs: unknown[] }> {
    return this.postToOrchestrator("/api/v1/agents/handoff-chain", { patient_id: patientId });
  }

  /**
   * Draft the post-encounter package (follow-up slots, care instructions,
   * lab prep, outreach payloads) from a finalized discharge order.
   *
   * Everything returned is a DRAFT: the receptionist agent books nothing and
   * sends nothing (services/orchestrator/receptionist_agent.py).
   */
  async postCare(patientId: string, dischargeOrder: unknown): Promise<Record<string, unknown>> {
    return this.postToOrchestrator("/api/v1/agents/post-care", {
      patient_id: patientId,
      discharge_order: dischargeOrder ?? {},
    });
  }
}
