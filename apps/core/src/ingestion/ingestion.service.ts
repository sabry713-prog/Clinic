import { Injectable, Logger, Inject } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { PG_POOL } from "../database/database.module";
import { ConfigService } from "@nestjs/config";
import { FhirClient } from "@clinical-copilot/fhir-client";
import {
  mapPatient,
  mapEncounter,
  mapObservation,
  mapAllergy,
  mapCondition,
  mapMedicationRequest,
  mapDocumentReference,
  type PatientRow,
} from "./fhir-mapper";
import {
  scoreReconciliation,
  type ReconcilablePatient,
} from "./identity-reconciler";
import { writeAuditEvent } from "@clinical-copilot/audit";
import type { RequestId } from "@clinical-copilot/shared-types";
import { v4 as uuidv4 } from "uuid";

export interface IngestionRunResult {
  readonly runId: string;
  readonly patientsProcessed: number;
  readonly resourcesUpserted: number;
  readonly quarantineCreated: number;
  readonly errors: readonly string[];
  readonly status: "completed" | "failed";
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
  ) {}

  async runIngestion(sourceSystem?: string): Promise<IngestionRunResult> {
    const runId = uuidv4();
    const source = sourceSystem ?? this.config.get<string>("FHIR_SOURCE_SYSTEM") ?? "hapi-sandbox";
    const requestId = uuidv4() as RequestId;

    this.logger.log({ event: "ingestion_started", run_id: runId, source });

    // Record run start
    await this.pool.query(
      `INSERT INTO app.ingestion_run (id, source_system, status)
       VALUES ($1, $2, 'running')`,
      [runId, source],
    );

    await writeAuditEvent(this.pool, {
      actor_id: null,
      actor_role: null,
      action: "INGESTION_RUN_STARTED",
      target_type: "ingestion_run",
      target_id: runId,
      outcome: "SUCCESS",
      metadata_json: { source_system: source },
      request_id: requestId,
    });

    let patientsProcessed = 0;
    let resourcesUpserted = 0;
    let quarantineCreated = 0;
    const errors: string[] = [];

    const client = this.createFhirClient();

    try {
      // Pull all patients in pages
      for await (const fhirPatient of client.iteratePatients({ _count: "50" })) {
        try {
          const patientRow = mapPatient(fhirPatient, source);
          const patientId = await this.upsertPatient(patientRow);

          if (patientId === null) {
            patientsProcessed++;
            continue;
          }

          // Reconcile with existing patients sharing national_id_hash or MRN
          const didQuarantine = await this.reconcileIdentity(patientId, patientRow, requestId);
          if (didQuarantine) quarantineCreated++;

          // Pull related resources for this patient
          const fhirId = fhirPatient.id ?? "";
          const related = await this.fetchPatientResources(client, fhirId, source);
          const upserted = await this.upsertRelatedResources(patientId, related);
          resourcesUpserted += upserted;

          patientsProcessed++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(msg);
          this.logger.warn({ event: "ingestion_patient_error", err: msg });
        }
      }

      const status = "completed";
      await this.pool.query(
        `UPDATE app.ingestion_run
         SET completed_at = now(), patients_processed = $1,
             resources_upserted = $2, quarantine_created = $3,
             errors_json = $4, status = $5
         WHERE id = $6`,
        [patientsProcessed, resourcesUpserted, quarantineCreated, JSON.stringify(errors), status, runId],
      );

      await writeAuditEvent(this.pool, {
        actor_id: null,
        actor_role: null,
        action: "INGESTION_RUN_COMPLETED",
        target_type: "ingestion_run",
        target_id: runId,
        outcome: "SUCCESS",
        metadata_json: {
          source_system: source,
          patients_processed: patientsProcessed,
          resources_upserted: resourcesUpserted,
          quarantine_created: quarantineCreated,
          errors_count: errors.length,
        },
        request_id: requestId,
      });

      this.logger.log({
        event: "ingestion_completed",
        run_id: runId,
        patients_processed: patientsProcessed,
        resources_upserted: resourcesUpserted,
        quarantine_created: quarantineCreated,
      });

      return { runId, patientsProcessed, resourcesUpserted, quarantineCreated, errors, status };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);

      await this.pool.query(
        `UPDATE app.ingestion_run
         SET completed_at = now(), errors_json = $1, status = 'failed'
         WHERE id = $2`,
        [JSON.stringify(errors), runId],
      );

      this.logger.error({ event: "ingestion_failed", run_id: runId, err: msg });

      return { runId, patientsProcessed, resourcesUpserted, quarantineCreated, errors, status: "failed" };
    }
  }

  // ─── Patient upsert ────────────────────────────────────────────────────────

  /**
   * Upsert a patient row. Returns the internal UUID, or null if the upsert
   * should be skipped (e.g. duplicate within same run).
   */
  private async upsertPatient(row: PatientRow): Promise<string | null> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO hospital.patient
         (source_system, source_id, mrn, national_id_hash, display_name,
          family_name, given_name, date_of_birth, sex, preferred_language,
          fhir_resource_json, last_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
       ON CONFLICT (source_system, source_id)
       DO UPDATE SET
         mrn = EXCLUDED.mrn,
         national_id_hash = EXCLUDED.national_id_hash,
         display_name = EXCLUDED.display_name,
         family_name = EXCLUDED.family_name,
         given_name = EXCLUDED.given_name,
         date_of_birth = EXCLUDED.date_of_birth,
         sex = EXCLUDED.sex,
         preferred_language = EXCLUDED.preferred_language,
         fhir_resource_json = EXCLUDED.fhir_resource_json,
         last_synced_at = now(),
         updated_at = now()
       RETURNING id`,
      [
        row.source_system,
        row.source_id,
        row.mrn,
        row.national_id_hash,
        row.display_name,
        row.family_name,
        row.given_name,
        row.date_of_birth,
        row.sex,
        row.preferred_language,
        JSON.stringify(row.fhir_resource_json),
      ],
    );

    return result.rows[0]?.id ?? null;
  }

  // ─── Identity reconciliation ───────────────────────────────────────────────

  private async reconcileIdentity(
    patientId: string,
    row: PatientRow,
    requestId: RequestId,
  ): Promise<boolean> {
    // Find candidates that could be the same person
    const candidates = await this.findReconciliationCandidates(patientId, row);
    let quarantined = false;

    for (const candidate of candidates) {
      const candidatePatient = await this.loadReconcilablePatient(candidate.id);
      if (!candidatePatient) continue;

      const currentPatient: ReconcilablePatient = {
        id: patientId,
        national_id_hash: row.national_id_hash,
        mrn: row.mrn,
        source_system: row.source_system,
        date_of_birth: row.date_of_birth,
        family_name: row.family_name,
        given_name: row.given_name,
        sex: row.sex,
      };

      const result = scoreReconciliation(currentPatient, candidatePatient);

      if (result.decision === "merge") {
        // Point all references to the earliest-created patient
        // (simple: just ensure the newer record knows about the older one)
        // For now, upsert handles this via source_system/source_id uniqueness.
        // True merging would update patient_id FK references -- deferred for admin flow.
        this.logger.log({
          event: "identity_auto_merge",
          patient_a: patientId,
          patient_b: candidate.id,
          score: result.score,
        });
      } else if (result.decision === "quarantine") {
        // Check if quarantine already exists for this pair
        const existing = await this.pool.query(
          `SELECT id FROM app.identity_quarantine
           WHERE (candidate_a_id = $1 AND candidate_b_id = $2)
              OR (candidate_a_id = $2 AND candidate_b_id = $1)
           LIMIT 1`,
          [patientId, candidate.id],
        );

        if (existing.rows.length === 0) {
          const quarantineId = uuidv4();
          await this.pool.query(
            `INSERT INTO app.identity_quarantine
               (id, candidate_a_id, candidate_b_id, confidence, features_json, status)
             VALUES ($1, $2, $3, $4, $5, 'open')`,
            [
              quarantineId,
              patientId,
              candidate.id,
              result.score / 100,
              JSON.stringify(result.features),
            ],
          );

          await writeAuditEvent(this.pool, {
            actor_id: null,
            actor_role: null,
            action: "IDENTITY_QUARANTINE_CREATED",
            target_type: "identity_quarantine",
            target_id: quarantineId,
            outcome: "SUCCESS",
            metadata_json: {
              candidate_a: patientId,
              candidate_b: candidate.id,
              score: result.score,
            },
            request_id: requestId,
          });

          quarantined = true;
        }
      }
      // separate → do nothing
    }

    return quarantined;
  }

  private async findReconciliationCandidates(
    excludeId: string,
    row: PatientRow,
  ): Promise<Array<{ id: string }>> {
    // Find patients that share national_id_hash OR (same source + MRN)
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM hospital.patient
       WHERE id != $1
         AND (
           (national_id_hash IS NOT NULL AND national_id_hash = $2)
           OR (source_system = $3 AND mrn IS NOT NULL AND mrn = $4)
         )
       LIMIT 10`,
      [excludeId, row.national_id_hash, row.source_system, row.mrn],
    );
    return result.rows;
  }

  private async loadReconcilablePatient(id: string): Promise<ReconcilablePatient | null> {
    const result = await this.pool.query<ReconcilablePatient>(
      `SELECT id, national_id_hash, mrn, source_system,
              date_of_birth::text as date_of_birth,
              family_name, given_name, sex
       FROM hospital.patient WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  // ─── Related resources ─────────────────────────────────────────────────────

  private async fetchPatientResources(
    client: FhirClient,
    fhirPatientId: string,
    _source: string,
  ): Promise<{
    encounters: ReturnType<typeof mapEncounter>[];
    observations: ReturnType<typeof mapObservation>[];
    allergies: ReturnType<typeof mapAllergy>[];
    conditions: ReturnType<typeof mapCondition>[];
    medications: ReturnType<typeof mapMedicationRequest>[];
    documents: ReturnType<typeof mapDocumentReference>[];
  }> {
    const source = _source;
    const [encBundle, obsBundle, allergyBundle, condBundle, medBundle, docBundle] =
      await Promise.all([
        client.searchEncounters({ subject: `Patient/${fhirPatientId}`, _count: "100" }).catch(() => ({ entry: [] })),
        client.searchObservations({ subject: `Patient/${fhirPatientId}`, _count: "100" }).catch(() => ({ entry: [] })),
        client.searchAllergies({ patient: `Patient/${fhirPatientId}`, _count: "100" }).catch(() => ({ entry: [] })),
        client.searchConditions({ subject: `Patient/${fhirPatientId}`, _count: "100" }).catch(() => ({ entry: [] })),
        client.searchMedicationRequests({ subject: `Patient/${fhirPatientId}`, _count: "100" }).catch(() => ({ entry: [] })),
        client.searchDocumentReferences({ subject: `Patient/${fhirPatientId}`, _count: "100" }).catch(() => ({ entry: [] })),
      ]);

    return {
      encounters: (encBundle.entry ?? []).map((e) => e.resource ? mapEncounter(e.resource, source) : null).filter((r): r is NonNullable<typeof r> => r !== null),
      observations: (obsBundle.entry ?? []).map((e) => e.resource ? mapObservation(e.resource, source) : null).filter((r): r is NonNullable<typeof r> => r !== null),
      allergies: (allergyBundle.entry ?? []).map((e) => e.resource ? mapAllergy(e.resource, source) : null).filter((r): r is NonNullable<typeof r> => r !== null),
      conditions: (condBundle.entry ?? []).map((e) => e.resource ? mapCondition(e.resource, source) : null).filter((r): r is NonNullable<typeof r> => r !== null),
      medications: (medBundle.entry ?? []).map((e) => e.resource ? mapMedicationRequest(e.resource, source) : null).filter((r): r is NonNullable<typeof r> => r !== null),
      documents: (docBundle.entry ?? []).map((e) => e.resource ? mapDocumentReference(e.resource, source) : null).filter((r): r is NonNullable<typeof r> => r !== null),
    };
  }

  private async upsertRelatedResources(
    patientDbId: string,
    resources: Awaited<ReturnType<IngestionService["fetchPatientResources"]>>,
  ): Promise<number> {
    const client: PoolClient = await this.pool.connect();
    let count = 0;
    try {
      await client.query("BEGIN");

      for (const enc of resources.encounters) {
        if (!enc) continue;
        await client.query(
          `INSERT INTO hospital.encounter
             (patient_id, source_system, source_id, encounter_type, status,
              started_at, ended_at, ward, bed, fhir_resource_json, last_synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
           ON CONFLICT (source_system, source_id)
           DO UPDATE SET
             encounter_type = EXCLUDED.encounter_type,
             status = EXCLUDED.status,
             started_at = EXCLUDED.started_at,
             ended_at = EXCLUDED.ended_at,
             ward = EXCLUDED.ward,
             bed = EXCLUDED.bed,
             fhir_resource_json = EXCLUDED.fhir_resource_json,
             last_synced_at = now()`,
          [patientDbId, enc.source_system, enc.source_id, enc.encounter_type,
           enc.status, enc.started_at, enc.ended_at, enc.ward, enc.bed,
           JSON.stringify(enc.fhir_resource_json)],
        );
        count++;
      }

      for (const obs of resources.observations) {
        if (!obs) continue;
        await client.query(
          `INSERT INTO hospital.observation
             (patient_id, source_system, source_id, category, code_system, code,
              code_display, value_numeric, value_text, unit, ref_range_low,
              ref_range_high, ref_range_text, status, effective_at,
              fhir_resource_json, last_synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())
           ON CONFLICT (source_system, source_id)
           DO UPDATE SET
             value_numeric = EXCLUDED.value_numeric,
             value_text = EXCLUDED.value_text,
             status = EXCLUDED.status,
             fhir_resource_json = EXCLUDED.fhir_resource_json,
             last_synced_at = now()`,
          [patientDbId, obs.source_system, obs.source_id, obs.category,
           obs.code_system, obs.code, obs.code_display, obs.value_numeric,
           obs.value_text, obs.unit, obs.ref_range_low, obs.ref_range_high,
           obs.ref_range_text, obs.status, obs.effective_at,
           JSON.stringify(obs.fhir_resource_json)],
        );
        count++;
      }

      for (const allergy of resources.allergies) {
        if (!allergy) continue;
        await client.query(
          `INSERT INTO hospital.allergy_intolerance
             (patient_id, source_system, source_id, code_system, code,
              code_display, reaction, severity, recorded_at, fhir_resource_json, last_synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
           ON CONFLICT (source_system, source_id)
           DO UPDATE SET
             code_display = EXCLUDED.code_display,
             reaction = EXCLUDED.reaction,
             severity = EXCLUDED.severity,
             fhir_resource_json = EXCLUDED.fhir_resource_json,
             last_synced_at = now()`,
          [patientDbId, allergy.source_system, allergy.source_id,
           allergy.code_system, allergy.code, allergy.code_display,
           allergy.reaction, allergy.severity, allergy.recorded_at,
           JSON.stringify(allergy.fhir_resource_json)],
        );
        count++;
      }

      for (const cond of resources.conditions) {
        if (!cond) continue;
        await client.query(
          `INSERT INTO hospital.condition
             (patient_id, source_system, source_id, code_system, code,
              code_display, status, onset_date, fhir_resource_json, last_synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
           ON CONFLICT (source_system, source_id)
           DO UPDATE SET
             status = EXCLUDED.status,
             fhir_resource_json = EXCLUDED.fhir_resource_json,
             last_synced_at = now()`,
          [patientDbId, cond.source_system, cond.source_id, cond.code_system,
           cond.code, cond.code_display, cond.status, cond.onset_date,
           JSON.stringify(cond.fhir_resource_json)],
        );
        count++;
      }

      for (const med of resources.medications) {
        if (!med) continue;
        await client.query(
          `INSERT INTO hospital.medication_request
             (patient_id, source_system, source_id, medication_display, code_system,
              code, dose, route, frequency, status, prescriber_display,
              started_at, ended_at, fhir_resource_json, last_synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
           ON CONFLICT (source_system, source_id)
           DO UPDATE SET
             status = EXCLUDED.status,
             fhir_resource_json = EXCLUDED.fhir_resource_json,
             last_synced_at = now()`,
          [patientDbId, med.source_system, med.source_id, med.medication_display,
           med.code_system, med.code, med.dose, med.route, med.frequency,
           med.status, med.prescriber_display, med.started_at, med.ended_at,
           JSON.stringify(med.fhir_resource_json)],
        );
        count++;
      }

      for (const doc of resources.documents) {
        if (!doc) continue;
        await client.query(
          `INSERT INTO hospital.document_reference
             (patient_id, source_system, source_id, type, authored_at,
              author_display, content_url, content_text, fhir_resource_json, last_synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
           ON CONFLICT (source_system, source_id)
           DO UPDATE SET
             type = EXCLUDED.type,
             content_text = EXCLUDED.content_text,
             fhir_resource_json = EXCLUDED.fhir_resource_json,
             last_synced_at = now()`,
          [patientDbId, doc.source_system, doc.source_id, doc.type,
           doc.authored_at, doc.author_display, doc.content_url, doc.content_text,
           JSON.stringify(doc.fhir_resource_json)],
        );
        count++;
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    return count;
  }

  // ─── FHIR client factory ───────────────────────────────────────────────────

  private createFhirClient(): FhirClient {
    const baseUrl = this.config.get<string>("FHIR_BASE_URL") ?? "https://hapi.fhir.org/baseR4";
    const authMode = this.config.get<string>("FHIR_AUTH_MODE") ?? "none";

    if (authMode === "oauth2") {
      return new FhirClient({
        baseUrl,
        auth: {
          mode: "oauth2",
          oauth2: {
            tokenUrl: this.config.getOrThrow("FHIR_TOKEN_URL"),
            clientId: this.config.getOrThrow("FHIR_CLIENT_ID"),
            clientSecret: this.config.getOrThrow("FHIR_CLIENT_SECRET"),
          },
        },
      });
    }

    return new FhirClient({ baseUrl, auth: { mode: "none" } });
  }
}
