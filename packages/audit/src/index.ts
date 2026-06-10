import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type {
  AuditAction,
  AuditEventId,
  AuditOutcome,
  RequestId,
  UserId,
  UserRole,
} from "@clinical-copilot/shared-types";

export interface AuditWriteInput {
  readonly actor_id: UserId | null;
  readonly actor_role: UserRole | null;
  readonly action: AuditAction | string;
  readonly target_type: string | null;
  readonly target_id: string | null;
  readonly outcome: AuditOutcome;
  /** Must NOT contain PHI */
  readonly metadata_json: Record<string, unknown>;
  readonly request_id: RequestId | null;
}

export interface AuditWriteResult {
  readonly id: AuditEventId;
  readonly hash_self: string;
}

/**
 * Canonical JSON serialisation for hash computation.
 * Keys are sorted alphabetically so the output is deterministic.
 */
function canonicalJson(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/**
 * Compute hash_self for an audit row.
 * hash_self = SHA-256(canonical JSON of all row fields including hash_prev)
 */
function computeHashSelf(row: {
  id: string;
  ts: string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  outcome: string;
  metadata_json: Record<string, unknown>;
  request_id: string | null;
  hash_prev: string | null;
}): string {
  const canonical = canonicalJson({
    id: row.id,
    ts: row.ts,
    actor_id: row.actor_id,
    actor_role: row.actor_role,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    outcome: row.outcome,
    metadata_json: row.metadata_json,
    request_id: row.request_id,
    hash_prev: row.hash_prev,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Writes a single audit event to the database.
 * Retrieves the most recent hash_self to chain to, then inserts atomically.
 *
 * Uses a transaction with SERIALIZABLE isolation to prevent hash-chain races.
 */
export async function writeAuditEvent(
  pool: Pool,
  input: AuditWriteInput,
): Promise<AuditWriteResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");

    // Get the previous row's hash for chain continuity
    const prevResult = await client.query<{ hash_self: string }>(
      "SELECT hash_self FROM audit.event ORDER BY ts DESC, id DESC LIMIT 1",
    );
    const hash_prev: string | null = prevResult.rows[0]?.hash_self ?? null;

    // Generate a UUID v4 (node-pg will generate if we use DEFAULT, but we need
    // the ID for hash computation before insert)
    const idResult = await client.query<{ id: string }>(
      "SELECT gen_random_uuid()::text AS id",
    );
    const id = idResult.rows[0]?.id;
    if (!id) throw new Error("Failed to generate UUID");

    const ts = new Date().toISOString();

    const hash_self = computeHashSelf({
      id,
      ts,
      actor_id: input.actor_id,
      actor_role: input.actor_role,
      action: input.action,
      target_type: input.target_type,
      target_id: input.target_id,
      outcome: input.outcome,
      metadata_json: input.metadata_json,
      request_id: input.request_id,
      hash_prev,
    });

    await client.query(
      `INSERT INTO audit.event
         (id, ts, actor_id, actor_role, action, target_type, target_id,
          outcome, metadata_json, request_id, hash_prev, hash_self)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        ts,
        input.actor_id,
        input.actor_role,
        input.action,
        input.target_type,
        input.target_id,
        input.outcome,
        JSON.stringify(input.metadata_json),
        input.request_id,
        hash_prev,
        hash_self,
      ],
    );

    await client.query("COMMIT");

    return { id: id as AuditEventId, hash_self };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Verifies the integrity of the audit log hash chain.
 * Returns { valid: true } if all hashes are consistent, otherwise details of
 * the first broken link.
 */
export async function verifyAuditChain(
  pool: Pool,
): Promise<{ valid: boolean; broken_at?: string; reason?: string }> {
  const rows = await pool.query<{
    id: string;
    ts: string;
    actor_id: string | null;
    actor_role: string | null;
    action: string;
    target_type: string | null;
    target_id: string | null;
    outcome: string;
    metadata_json: Record<string, unknown>;
    request_id: string | null;
    hash_prev: string | null;
    hash_self: string;
  }>(
    `SELECT id, ts::text, actor_id::text, actor_role, action, target_type,
            target_id::text, outcome, metadata_json, request_id, hash_prev, hash_self
     FROM audit.event
     ORDER BY ts ASC, id ASC`,
  );

  let prev_hash: string | null = null;

  for (const row of rows.rows) {
    if (row.hash_prev !== prev_hash) {
      return {
        valid: false,
        broken_at: row.id,
        reason: `hash_prev mismatch: expected ${prev_hash ?? "null"} got ${row.hash_prev ?? "null"}`,
      };
    }

    const expected = computeHashSelf({
      id: row.id,
      ts: row.ts,
      actor_id: row.actor_id,
      actor_role: row.actor_role,
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      outcome: row.outcome,
      metadata_json: row.metadata_json,
      request_id: row.request_id,
      hash_prev: row.hash_prev,
    });

    if (expected !== row.hash_self) {
      return {
        valid: false,
        broken_at: row.id,
        reason: `hash_self mismatch: expected ${expected} got ${row.hash_self}`,
      };
    }

    prev_hash = row.hash_self;
  }

  return { valid: true };
}
