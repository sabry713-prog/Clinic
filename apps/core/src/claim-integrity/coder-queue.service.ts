/**
 * CoderQueueService — in-memory review queue for RCM teams (E3).
 *
 * The current claim workflow is clinician-first: coding confirmations and
 * linkages happen per patient inside the clinician's panel. This queue is the
 * batch surface for the people who clear claim defects at scale — hospital
 * coders / RCM staff see every flagged claim-integrity finding across
 * patients, claim items for review, and resolve them.
 *
 * PROTOTYPE SCOPE — deliberately in-memory (no durable backend until Phase
 * Cert): the queue is rebuilt deterministically from a claim-simulation run
 * via sync(), lives in this process, and is lost on restart. Human state
 * (in-review/claimed-by/resolved + notes) is preserved across a re-sync for
 * as long as the process lives, but promoting this to a Postgres-backed table
 * is a Phase-Cert migration, not a schema change now.
 *
 * Non-SaMD (CLAUDE.md §2): items are administrative findings only — a
 * missing code confirmation, an undocumented necessity rule, a pre-auth
 * requirement. Nothing here characterizes a patient's condition.
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  ClaimSimulationReport,
  SimulatorOrderNecessity,
  SimulatorPatientVerdict,
} from "./claim-simulator.service";

export type CoderQueueItemStatus = "pending" | "in_review" | "resolved";
export type CoderQueueReason =
  | "blocked_readiness"
  | "readiness_issues"
  | "necessity_red"
  | "necessity_yellow";

export interface CoderQueueItem {
  readonly item_id: string;
  readonly patient_id: string;
  readonly mrn: string | null;
  readonly order_id: string | null;
  readonly icd10_code: string | null;
  readonly sbs_code: string | null;
  readonly reason: CoderQueueReason;
  readonly detail: string;
  readonly status: CoderQueueItemStatus;
  readonly claimed_by: string | null;
  readonly resolved_note: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface CoderQueueSyncResult {
  readonly queue_size: number;
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  readonly preserved: number;
  readonly simulation_summary: ClaimSimulationReport["summary"];
}

/** Stable item identity across re-syncs: the finding is keyed by the exact
 * administrative defect (patient + order + reason), not a row id, so
 * re-running the deterministic simulation maps onto the same queue entries. */
function itemId(patientId: string, orderId: string | null, reason: CoderQueueReason): string {
  return orderId ? `${patientId}:${orderId}:${reason}` : `${patientId}:${reason}`;
}

@Injectable()
export class CoderQueueService {
  private readonly logger = new Logger(CoderQueueService.name);
  private items = new Map<string, CoderQueueItem>();

  /** Current queue, pending-first then most-recently-updated. */
  list(): readonly CoderQueueItem[] {
    const order: Record<CoderQueueItemStatus, number> = { pending: 0, in_review: 1, resolved: 2 };
    return [...this.items.values()].sort((a, b) => {
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0;
    });
  }

  /**
   * Rebuild the flag set from a deterministic simulation run.
   *
   * - New findings are appended as pending.
   * - Existing findings keep their human state (status/claim/resolve) and
   *   only have detail refreshed — a re-run must never un-claim or
   *   un-resolve a person's work.
   * - Findings that are no longer flagged AND still unresolved are removed
   *   (the defect went away); resolved items are kept as session history.
   */
  sync(report: ClaimSimulationReport): CoderQueueSyncResult {
    const now = new Date().toISOString();
    const next = new Map<string, CoderQueueItem>();
    let added = 0;
    let updated = 0;
    let preserved = 0;

    for (const verdict of report.patients) {
      for (const finding of findingsFor(verdict)) {
        const id = itemId(verdict.patient_id, finding.order_id, finding.reason);
        const existing = this.items.get(id);
        if (existing) {
          preserved += 1;
          next.set(id, { ...existing, detail: finding.detail, updated_at: now });
        } else {
          added += 1;
          next.set(id, {
            item_id: id,
            patient_id: verdict.patient_id,
            mrn: verdict.mrn,
            order_id: finding.order_id,
            icd10_code: finding.icd10_code,
            sbs_code: finding.sbs_code,
            reason: finding.reason,
            detail: finding.detail,
            status: "pending",
            claimed_by: null,
            resolved_note: null,
            created_at: now,
            updated_at: now,
          });
        }
      }
    }

    let removed = 0;
    for (const [id, existing] of this.items) {
      if (!next.has(id)) {
        if (existing.status === "resolved") {
          // Keep resolved history for the session even if the flag cleared.
          updated += 1;
          next.set(id, existing);
        } else {
          removed += 1;
        }
      }
    }

    this.items = next;
    this.logger.log("coder_queue_synced", { added, preserved, removed, size: this.items.size });
    return {
      queue_size: this.items.size,
      added,
      updated,
      removed,
      preserved,
      simulation_summary: report.summary,
    };
  }

  /** Mark an item as being worked on by `userId`. */
  claim(itemId: string, userId: string): CoderQueueItem {
    const item = this.items.get(itemId);
    if (!item) throwItemNotFound(itemId);
    if (item.status === "resolved") {
      throw new NotFoundException({
        error: { code: "CODER_QUEUE_ITEM_RESOLVED", message: "Item is already resolved" },
      });
    }
    const updated: CoderQueueItem = {
      ...item,
      status: "in_review",
      claimed_by: userId,
      updated_at: new Date().toISOString(),
    };
    this.items.set(itemId, updated);
    return updated;
  }

  /** Resolve an item with a note (what the coder did about it). */
  resolve(itemId: string, userId: string, note: string): CoderQueueItem {
    const item = this.items.get(itemId);
    if (!item) throwItemNotFound(itemId);
    const updated: CoderQueueItem = {
      ...item,
      status: "resolved",
      claimed_by: item.claimed_by ?? userId,
      resolved_note: note,
      updated_at: new Date().toISOString(),
    };
    this.items.set(itemId, updated);
    return updated;
  }
}

function throwItemNotFound(itemId: string): never {
  throw new NotFoundException({
    error: { code: "CODER_QUEUE_ITEM_NOT_FOUND", message: `No queue item ${itemId}` },
  });
}

interface Finding {
  readonly order_id: string | null;
  readonly icd10_code: string | null;
  readonly sbs_code: string | null;
  readonly reason: CoderQueueReason;
  readonly detail: string;
}

/** Deterministic flag extraction from one patient verdict. Order matters for
 * stability: patient-level blockers first, then per-order necessity findings
 * in the report's (already sorted) order. */
function findingsFor(verdict: SimulatorPatientVerdict): readonly Finding[] {
  const findings: Finding[] = [];
  if (verdict.readiness_overall === "blocked") {
    findings.push({
      order_id: null,
      icd10_code: null,
      sbs_code: null,
      reason: "blocked_readiness",
      detail: `Blocked by readiness check(s): ${verdict.failed_checks.join(", ")}.`,
    });
  } else if (verdict.readiness_overall === "issues") {
    findings.push({
      order_id: null,
      icd10_code: null,
      sbs_code: null,
      reason: "readiness_issues",
      detail: `Warnings to clear before sending: ${verdict.warning_checks.join(", ")}.`,
    });
  }
  for (const order of verdict.necessity) {
    const finding = necessityFinding(order);
    if (finding) findings.push(finding);
  }
  return findings;
}

function necessityFinding(order: SimulatorOrderNecessity): Finding | null {
  if (order.status === "RED") {
    const suggested = order.suggested_codes.map((s) => s.icd10).join(", ");
    return {
      order_id: order.order_id,
      icd10_code: order.icd10_code,
      sbs_code: order.sbs_code,
      reason: "necessity_red",
      detail:
        `No documented necessity rule for ${order.icd10_code} -> ${order.sbs_code}` +
        (suggested ? `; documented justifying diagnoses: ${suggested}.` : "."),
    };
  }
  if (order.status === "YELLOW") {
    return {
      order_id: order.order_id,
      icd10_code: order.icd10_code,
      sbs_code: order.sbs_code,
      reason: "necessity_yellow",
      detail: `Pre-authorization is documented as required for ${order.icd10_code} -> ${order.sbs_code}.`,
    };
  }
  return null;
}
