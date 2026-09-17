/**
 * CoderQueueService — Postgres-backed review queue for RCM teams (E3, M09).
 *
 * The current claim workflow is clinician-first: coding confirmations and
 * linkages happen per patient inside the clinician's panel. This queue is the
 * batch surface for the people who clear claim defects at scale — hospital
 * coders / RCM staff see every flagged claim-integrity finding across
 * patients, claim items for review, and resolve them.
 *
 * M09 (readiness assessment): the queue is now durable — persisted to
 * app.coder_queue_item in Postgres. Restart no longer loses claim/resolve
 * state. Re-syncs use the same stable identity scheme (patient + order +
 * reason) so findings map onto the same rows, and human state
 * (in-review/claimed-by/resolved) is preserved across re-syncs.
 *
 * Non-SaMD (CLAUDE.md §2): items are administrative findings only — a
 * missing code confirmation, an undocumented necessity rule, a pre-auth
 * requirement. Nothing here characterizes a patient's condition.
 */

import { Injectable, Inject, Logger, NotFoundException } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
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

interface QueueRow {
  item_id: string;
  patient_id: string;
  mrn: string | null;
  order_id: string | null;
  icd10_code: string | null;
  sbs_code: string | null;
  reason: string;
  detail: string;
  status: string;
  claimed_by: string | null;
  resolved_note: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToItem(row: QueueRow): CoderQueueItem {
  return {
    item_id: row.item_id,
    patient_id: row.patient_id,
    mrn: row.mrn,
    order_id: row.order_id,
    icd10_code: row.icd10_code,
    sbs_code: row.sbs_code,
    reason: row.reason as CoderQueueReason,
    detail: row.detail,
    status: row.status as CoderQueueItemStatus,
    claimed_by: row.claimed_by,
    resolved_note: row.resolved_note,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

@Injectable()
export class CoderQueueService {
  private readonly logger = new Logger(CoderQueueService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Current queue from Postgres, pending-first then most-recently-updated. */
  async list(): Promise<readonly CoderQueueItem[]> {
    const result = await this.pool.query<QueueRow>(
      `SELECT * FROM app.coder_queue_item
       ORDER BY
         CASE status WHEN 'pending' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,
         updated_at DESC`,
    );
    return result.rows.map(rowToItem);
  }

  /**
   * Rebuild the flag set from a deterministic simulation run (durable).
   *
   * - New findings are appended as pending.
   * - Existing findings keep their human state (status/claim/resolve) and
   *   only have detail refreshed — a re-run must never un-claim or
   *   un-resolve a person's work.
   * - Findings that are no longer flagged AND still unresolved are removed
   *   (the defect went away); resolved items are kept as history.
   */
  async sync(report: ClaimSimulationReport): Promise<CoderQueueSyncResult> {
    // M09: the whole rebuild runs in one transaction. It used to be a sequence of
    // independent statements, so a failure partway through left the queue half
    // rebuilt -- some findings added, some refreshed, some stale rows still
    // present -- with nothing to roll back to. It also reported `updated: 0`
    // unconditionally while updating rows, so a caller reading the result
    // concluded that nothing had changed.
    const client = await this.pool.connect();

    let added = 0;
    let updated = 0;
    let preserved = 0;
    let removed = 0;
    let queueSize = 0;

    try {
      await client.query("BEGIN");

      // FOR UPDATE: a concurrent claim must not land between reading a row and
      // deciding whether to touch it.
      const existingResult = await client.query<QueueRow>(
        `SELECT * FROM app.coder_queue_item FOR UPDATE`,
      );
      const existing = new Map(existingResult.rows.map((r) => [r.item_id, r]));

      const nextIds = new Set<string>();

      for (const verdict of report.patients) {
        for (const finding of findingsFor(verdict)) {
          const id = itemId(verdict.patient_id, finding.order_id, finding.reason);
          nextIds.add(id);
          const prior = existing.get(id);

          if (!prior) {
            const inserted = await client.query(
              `INSERT INTO app.coder_queue_item
                 (item_id, patient_id, mrn, order_id, icd10_code, sbs_code, reason, detail)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (item_id) DO NOTHING`,
              [
                id,
                verdict.patient_id,
                verdict.mrn,
                finding.order_id,
                finding.icd10_code,
                finding.sbs_code,
                finding.reason,
                finding.detail,
              ],
            );
            added += inserted.rowCount ?? 0;
            continue;
          }

          if (prior.detail !== finding.detail) {
            // Only write when the detail actually changed. Touching updated_at on
            // a no-op sync made "most recently updated" meaningless, and made a
            // re-run look like work.
            const refreshed = await client.query(
              `UPDATE app.coder_queue_item SET detail = $2, updated_at = now()
                WHERE item_id = $1`,
              [id, finding.detail],
            );
            updated += refreshed.rowCount ?? 0;
          } else {
            preserved += 1;
          }
        }
      }

      // Remove unresolved items that are no longer flagged
      for (const [id, row] of existing) {
        if (!nextIds.has(id) && row.status !== "resolved") {
          const deleted = await client.query(
            `DELETE FROM app.coder_queue_item WHERE item_id = $1`,
            [id],
          );
          removed += deleted.rowCount ?? 0;
        }
      }

      const countResult = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM app.coder_queue_item`,
      );
      queueSize = Number(countResult.rows[0]!.count);

      await client.query("COMMIT");
    } catch (err) {
      await client
        .query("ROLLBACK")
        .catch(() => {
          /* the rollback is best-effort; the transaction aborts with the connection */
        });
      throw err;
    } finally {
      client.release();
    }

    this.logger.log("coder_queue_synced", {
      added,
      updated,
      preserved,
      removed,
      size: queueSize,
    });

    return {
      queue_size: queueSize,
      added,
      updated,
      removed,
      preserved,
      simulation_summary: report.summary,
    };
  }

  /** Mark an item as being worked on by `userId` (durable). */
  async claim(itemId: string, userId: string): Promise<CoderQueueItem> {
    const result = await this.pool.query<QueueRow>(
      `UPDATE app.coder_queue_item
       SET status = 'in_review', claimed_by = $2, updated_at = now()
       WHERE item_id = $1 AND status != 'resolved'
       RETURNING *`,
      [itemId, userId],
    );
    if (!result.rows[0]) {
      const existing = await this.pool.query(`SELECT status FROM app.coder_queue_item WHERE item_id = $1`, [itemId]);
      if (!existing.rows[0]) throwItemNotFound(itemId);
      throw new NotFoundException({
        error: { code: "CODER_QUEUE_ITEM_RESOLVED", message: "Item is already resolved" },
      });
    }
    return rowToItem(result.rows[0]);
  }

  /** Resolve an item with a note (what the coder did about it) — durable. */
  async resolve(itemId: string, userId: string, note: string): Promise<CoderQueueItem> {
    const result = await this.pool.query<QueueRow>(
      `UPDATE app.coder_queue_item
       SET status = 'resolved',
           claimed_by = COALESCE(claimed_by, $2),
           resolved_note = $3,
           updated_at = now()
       WHERE item_id = $1
       RETURNING *`,
      [itemId, userId, note],
    );
    if (!result.rows[0]) throwItemNotFound(itemId);
    return rowToItem(result.rows[0]);
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
