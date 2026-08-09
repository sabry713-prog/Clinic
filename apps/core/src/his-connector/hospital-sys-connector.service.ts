/**
 * HospitalSysConnectorService — dummy/stub transactional HIS connector.
 *
 * See docs/architecture/his-connector-hospital-sys.md for the full picture:
 * this is built against an ASSUMED interface profile (Cerner-class HL7v2
 * ORM/ORR order transactions), none of which is confirmed with any real
 * hospital's actual IT team — "hospital sys" is a generic stand-in, not a
 * named vendor/site. Provider pattern mirrors NphiesConnectorService (HIS_CONNECTOR=stub
 * returns simulated ORM->ORR round trips so the workflow runs without a real
 * integration; =live throws honestly — no network call exists yet).
 *
 * Boundary (CLAUDE.md §2): Cortex.ai performs NO interaction/allergy/dose
 * checking anywhere in this flow. The receiving HIS is the sole validator;
 * its accept/reject decision and reason are stored and displayed VERBATIM,
 * never interpreted, summarized, or rephrased. The transmitted content is
 * always re-derived server-side from the clinician's own confirmed order —
 * never trusted from the caller — same invariant as
 * ServiceRequestService.confirmAndCreate() and RefillRequestService.create().
 */
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "crypto";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { PatientScopeService } from "../patient/patient-scope.service";

export type TransmissionSourceType = "service_request" | "refill_request";
export type TransmissionStatus = "pending" | "accepted" | "rejected" | "failed";

export interface HisTransmission {
  readonly id: string;
  readonly patient_id: string;
  readonly source_type: TransmissionSourceType;
  readonly source_id: string;
  readonly message_type: string;
  readonly status: TransmissionStatus;
  readonly backend_reason_code: string | null;
  readonly backend_reason_text: string | null;
  readonly mode: string;
  readonly transmitted_at: string;
  readonly updated_at: string;
}

const TRANSMISSION_COLS = `id, patient_id, source_type, source_id, message_type, status,
  backend_reason_code, backend_reason_text, mode,
  transmitted_at::text AS transmitted_at, updated_at::text AS updated_at`;

// Canned simulated ORR rejection reasons for refill (medication) transmissions
// only — imaging/lab orders simulate acceptance almost always. These strings
// are exactly what gets displayed; nothing about them is generated or
// interpreted at render time.
const SIMULATED_MED_REJECTIONS: readonly { code: string; text: string }[] = [
  { code: "DUPLICATE_THERAPY", text: "Hospital System (simulated): an active order for this medication already exists in the pharmacy system." },
  { code: "FORMULARY_RESTRICTED", text: "Hospital System (simulated): this medication requires pharmacy formulary override approval before dispensing." },
];

@Injectable()
export class HospitalSysConnectorService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly scope: PatientScopeService,
    private readonly config: ConfigService,
  ) {}

  private mode(): "stub" | "live" {
    return this.config.get<string>("HIS_CONNECTOR") === "live" ? "live" : "stub";
  }

  async transmit(
    userId: string,
    patientId: string,
    sourceType: TransmissionSourceType,
    sourceId: string,
  ): Promise<HisTransmission> {
    await this.scope.assertPatientInScope(userId, patientId);

    // Re-derive the order content server-side — the caller supplies only a
    // reference, never the content itself, so there is nothing to "trust."
    const orderDisplay = await this.resolveOrderDisplay(patientId, sourceType, sourceId);

    const idempotencyKey = createHash("sha256").update(`${sourceType}:${sourceId}`).digest("hex");

    const existing = await this.pool.query<HisTransmission>(
      `SELECT ${TRANSMISSION_COLS} FROM app.his_order_transmission
        WHERE idempotency_key = $1 AND status IN ('pending', 'accepted')`,
      [idempotencyKey],
    );
    if (existing.rows[0]) return existing.rows[0];

    if (this.mode() === "live") {
      throw new BadRequestException({
        error: {
          code: "HOSPITAL_SYS_LIVE_NOT_CONFIGURED",
          message:
            "Hospital system live HIS connector selected but not implemented — requires confirmed interface " +
            "specification, interface-engine access, and sandbox credentials from the receiving hospital's IT team.",
        },
      });
    }

    const { status, reasonCode, reasonText } = this.simulateOrr(sourceType, sourceId);

    // The pending/accepted pre-check above is what stops a duplicate
    // transmission of an in-flight or already-accepted order. This upsert
    // additionally allows a legitimate RETRY after a prior rejected/failed
    // attempt — same idempotency key, but the row is refreshed with the new
    // outcome rather than silently discarding it.
    const res = await this.pool.query<HisTransmission>(
      `INSERT INTO app.his_order_transmission
         (patient_id, source_type, source_id, idempotency_key, status,
          backend_reason_code, backend_reason_text, mode, transmitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (idempotency_key) DO UPDATE SET
         status = EXCLUDED.status,
         backend_reason_code = EXCLUDED.backend_reason_code,
         backend_reason_text = EXCLUDED.backend_reason_text,
         mode = EXCLUDED.mode,
         transmitted_by = EXCLUDED.transmitted_by,
         transmitted_at = now(),
         updated_at = now()
       RETURNING ${TRANSMISSION_COLS}`,
      [patientId, sourceType, sourceId, idempotencyKey, status, reasonCode, reasonText, this.mode(), userId],
    );
    // orderDisplay is re-derived purely to prove the server-side lookup
    // succeeded (a missing/mismatched order throws NotFoundException above
    // before this point) — the ORM payload itself is not persisted here in
    // stub mode since no real message is actually sent.
    void orderDisplay;
    return res.rows[0]!;
  }

  async status(userId: string, patientId: string, sourceType: TransmissionSourceType, sourceId: string): Promise<HisTransmission | null> {
    await this.scope.assertPatientInScope(userId, patientId);
    const res = await this.pool.query<HisTransmission>(
      `SELECT ${TRANSMISSION_COLS} FROM app.his_order_transmission
        WHERE patient_id = $1 AND source_type = $2 AND source_id = $3
        ORDER BY transmitted_at DESC LIMIT 1`,
      [patientId, sourceType, sourceId],
    );
    return res.rows[0] ?? null;
  }

  async list(userId: string, patientId: string): Promise<HisTransmission[]> {
    await this.scope.assertPatientInScope(userId, patientId);
    const res = await this.pool.query<HisTransmission>(
      `SELECT ${TRANSMISSION_COLS} FROM app.his_order_transmission
        WHERE patient_id = $1 ORDER BY transmitted_at DESC LIMIT 100`,
      [patientId],
    );
    return res.rows;
  }

  private async resolveOrderDisplay(
    patientId: string,
    sourceType: TransmissionSourceType,
    sourceId: string,
  ): Promise<string> {
    const table = sourceType === "service_request" ? "app.service_request" : "app.refill_request";
    const displayCol = sourceType === "service_request" ? "code_display" : "medication_display";
    const res = await this.pool.query<{ display: string }>(
      `SELECT ${displayCol} AS display FROM ${table} WHERE id = $1 AND patient_id = $2`,
      [sourceId, patientId],
    );
    const row = res.rows[0];
    if (!row) throw new NotFoundException(`No ${sourceType} found for this patient to transmit`);
    return row.display;
  }

  // Deterministic simulated ORR (order response) — same source id always
  // produces the same outcome, matching the seed:nphies-claims precedent of
  // deterministic-not-random dev data. Never a real network call.
  private simulateOrr(
    sourceType: TransmissionSourceType,
    sourceId: string,
  ): { status: TransmissionStatus; reasonCode: string | null; reasonText: string | null } {
    const hash = createHash("sha256").update(sourceId).digest();
    const bucket = hash[0]! % 10;

    if (sourceType === "refill_request" && bucket < 2) {
      const reason = SIMULATED_MED_REJECTIONS[hash[1]! % SIMULATED_MED_REJECTIONS.length]!;
      return { status: "rejected", reasonCode: reason.code, reasonText: reason.text };
    }
    if (sourceType === "service_request" && bucket === 0) {
      return {
        status: "rejected",
        reasonCode: "DUPLICATE_ORDER",
        reasonText: "Hospital System (simulated): an equivalent order is already active in the RIS/LIS.",
      };
    }
    return { status: "accepted", reasonCode: null, reasonText: null };
  }
}
