/**
 * Maps FHIR R4 resources to internal hospital.* table row shapes.
 * No PHI is logged in this module — only IDs and codes.
 */

import { createHash } from "node:crypto";
import type {
  FhirPatient,
  FhirEncounter,
  FhirObservation,
  FhirAllergyIntolerance,
  FhirCondition,
  FhirMedicationRequest,
  FhirDocumentReference,
  FhirCoding,
  FhirCodeableConcept,
} from "@clinical-copilot/fhir-client";

export interface PatientRow {
  readonly source_system: string;
  readonly source_id: string;
  readonly mrn: string | null;
  readonly national_id_hash: string | null;
  readonly display_name: string | null;
  readonly family_name: string | null;
  readonly given_name: string | null;
  readonly date_of_birth: string | null;
  readonly sex: string | null;
  readonly preferred_language: string | null;
  readonly fhir_resource_json: unknown;
}

export interface EncounterRow {
  readonly source_system: string;
  readonly source_id: string;
  readonly patient_source_id: string;
  readonly encounter_type: string | null;
  readonly status: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly ward: string | null;
  readonly bed: string | null;
  readonly attending_fhir_ref: string | null;
  readonly fhir_resource_json: unknown;
}

export interface ObservationRow {
  readonly source_system: string;
  readonly source_id: string;
  readonly patient_source_id: string;
  readonly encounter_source_id: string | null;
  readonly category: string | null;
  readonly code_system: string | null;
  readonly code: string | null;
  readonly code_display: string | null;
  readonly value_numeric: number | null;
  readonly value_text: string | null;
  readonly unit: string | null;
  readonly ref_range_low: number | null;
  readonly ref_range_high: number | null;
  readonly ref_range_text: string | null;
  readonly status: string | null;
  readonly effective_at: string | null;
  readonly fhir_resource_json: unknown;
}

export interface AllergyRow {
  readonly source_system: string;
  readonly source_id: string;
  readonly patient_source_id: string;
  readonly code_system: string | null;
  readonly code: string | null;
  readonly code_display: string | null;
  readonly reaction: string | null;
  readonly severity: string | null;
  readonly recorded_at: string | null;
  readonly fhir_resource_json: unknown;
}

export interface ConditionRow {
  readonly source_system: string;
  readonly source_id: string;
  readonly patient_source_id: string;
  readonly code_system: string | null;
  readonly code: string | null;
  readonly code_display: string | null;
  readonly status: string | null;
  readonly onset_date: string | null;
  readonly fhir_resource_json: unknown;
}

export interface MedicationRequestRow {
  readonly source_system: string;
  readonly source_id: string;
  readonly patient_source_id: string;
  readonly encounter_source_id: string | null;
  readonly medication_display: string | null;
  readonly code_system: string | null;
  readonly code: string | null;
  readonly dose: string | null;
  readonly route: string | null;
  readonly frequency: string | null;
  readonly status: string | null;
  readonly prescriber_display: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly fhir_resource_json: unknown;
}

export interface DocumentReferenceRow {
  readonly source_system: string;
  readonly source_id: string;
  readonly patient_source_id: string;
  readonly encounter_source_id: string | null;
  readonly type: string | null;
  readonly authored_at: string | null;
  readonly author_display: string | null;
  readonly content_url: string | null;
  readonly content_text: string | null;
  readonly fhir_resource_json: unknown;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashNationalId(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function firstCoding(cc: FhirCodeableConcept | undefined): FhirCoding | undefined {
  return cc?.coding?.[0];
}

function refToSourceId(ref: string | undefined): string | null {
  if (!ref) return null;
  // Relative references: "ResourceType/id" — extract id
  const parts = ref.split("/");
  return parts[parts.length - 1] ?? null;
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

export function mapPatient(
  resource: FhirPatient,
  sourceSystem: string,
): PatientRow {
  const id = resource.id ?? "";

  // MRN: identifier with type.coding[].code === "MR"
  const mrnIdentifier = resource.identifier?.find((i) =>
    i.type?.coding?.some((c) => c.code === "MR"),
  );

  // National ID: identifier with type.coding[].code === "NI"
  const niIdentifier = resource.identifier?.find((i) =>
    i.type?.coding?.some((c) => c.code === "NI"),
  );

  const nationalIdHash = niIdentifier?.value
    ? hashNationalId(niIdentifier.value)
    : null;

  // Name
  const officialName =
    resource.name?.find((n) => n.use === "official") ?? resource.name?.[0];

  const displayName =
    officialName?.text ??
    [
      ...(officialName?.given ?? []),
      officialName?.family,
    ]
      .filter(Boolean)
      .join(" ") ||
    null;

  const familyName = officialName?.family ?? null;
  const givenName = officialName?.given?.join(" ") ?? null;

  // Preferred language
  const preferredComm = resource.communication?.find((c) => c.preferred === true);
  const preferredLanguage =
    firstCoding(preferredComm?.language)?.code ??
    preferredComm?.language?.text ??
    null;

  return {
    source_system: sourceSystem,
    source_id: id,
    mrn: mrnIdentifier?.value ?? null,
    national_id_hash: nationalIdHash,
    display_name: displayName,
    family_name: familyName,
    given_name: givenName,
    date_of_birth: resource.birthDate ?? null,
    sex: resource.gender ?? null,
    preferred_language: preferredLanguage,
    fhir_resource_json: resource,
  };
}

export function mapEncounter(
  resource: FhirEncounter,
  sourceSystem: string,
): EncounterRow | null {
  const id = resource.id;
  if (!id) return null;

  const patientRef = resource.subject?.reference;
  if (!patientRef) return null;

  // Attending: participant with type = ATND
  const attendingParticipant = resource.participant?.find((p) =>
    p.type?.some((t) => t.coding?.some((c) => c.code === "ATND")),
  );
  const attendingRef = attendingParticipant?.individual?.reference ?? null;

  const ward = resource.location?.[0]?.location?.display ?? null;

  return {
    source_system: sourceSystem,
    source_id: id,
    patient_source_id: refToSourceId(patientRef) ?? patientRef,
    encounter_type: resource.class?.code ?? null,
    status: resource.status ?? null,
    started_at: resource.period?.start ?? null,
    ended_at: resource.period?.end ?? null,
    ward,
    bed: null,
    attending_fhir_ref: attendingRef,
    fhir_resource_json: resource,
  };
}

export function mapObservation(
  resource: FhirObservation,
  sourceSystem: string,
): ObservationRow | null {
  const id = resource.id;
  if (!id) return null;

  const patientRef = resource.subject?.reference;
  if (!patientRef) return null;

  const encounterRef = resource.encounter?.reference ?? null;
  const categoryCoding = firstCoding(resource.category?.[0]);
  const codeCoding = firstCoding(resource.code);

  const refRange = resource.referenceRange?.[0];

  return {
    source_system: sourceSystem,
    source_id: id,
    patient_source_id: refToSourceId(patientRef) ?? patientRef,
    encounter_source_id: encounterRef ? refToSourceId(encounterRef) : null,
    category: categoryCoding?.code ?? null,
    code_system: codeCoding?.system ?? null,
    code: codeCoding?.code ?? null,
    code_display: codeCoding?.display ?? resource.code?.text ?? null,
    value_numeric: resource.valueQuantity?.value ?? null,
    value_text:
      resource.valueString ??
      firstCoding(resource.valueCodeableConcept)?.display ??
      resource.valueCodeableConcept?.text ??
      null,
    unit: resource.valueQuantity?.unit ?? null,
    ref_range_low: refRange?.low?.value ?? null,
    ref_range_high: refRange?.high?.value ?? null,
    ref_range_text: refRange?.text ?? null,
    status: resource.status ?? null,
    effective_at: resource.effectiveDateTime ?? resource.effectivePeriod?.start ?? null,
    fhir_resource_json: resource,
  };
}

export function mapAllergy(
  resource: FhirAllergyIntolerance,
  sourceSystem: string,
): AllergyRow | null {
  const id = resource.id;
  if (!id) return null;

  const patientRef = resource.patient?.reference;
  if (!patientRef) return null;

  const codeCoding = firstCoding(resource.code);
  const firstReaction = resource.reaction?.[0];
  const reactionDisplay = firstCoding(firstReaction?.manifestation?.[0])?.display ?? null;

  return {
    source_system: sourceSystem,
    source_id: id,
    patient_source_id: refToSourceId(patientRef) ?? patientRef,
    code_system: codeCoding?.system ?? null,
    code: codeCoding?.code ?? null,
    code_display: codeCoding?.display ?? resource.code?.text ?? null,
    reaction: reactionDisplay,
    severity: firstReaction?.severity ?? null,
    recorded_at: resource.recordedDate ?? null,
    fhir_resource_json: resource,
  };
}

export function mapCondition(
  resource: FhirCondition,
  sourceSystem: string,
): ConditionRow | null {
  const id = resource.id;
  if (!id) return null;

  const patientRef = resource.subject?.reference;
  if (!patientRef) return null;

  const codeCoding = firstCoding(resource.code);
  const statusCode = firstCoding(resource.clinicalStatus)?.code ?? null;

  return {
    source_system: sourceSystem,
    source_id: id,
    patient_source_id: refToSourceId(patientRef) ?? patientRef,
    code_system: codeCoding?.system ?? null,
    code: codeCoding?.code ?? null,
    code_display: codeCoding?.display ?? resource.code?.text ?? null,
    status: statusCode,
    onset_date: resource.onsetDateTime ?? resource.onsetPeriod?.start ?? null,
    fhir_resource_json: resource,
  };
}

export function mapMedicationRequest(
  resource: FhirMedicationRequest,
  sourceSystem: string,
): MedicationRequestRow | null {
  const id = resource.id;
  if (!id) return null;

  const patientRef = resource.subject?.reference;
  if (!patientRef) return null;

  const encounterRef = resource.encounter?.reference ?? null;

  const medCoding = firstCoding(resource.medicationCodeableConcept);
  const medDisplay =
    medCoding?.display ??
    resource.medicationCodeableConcept?.text ??
    resource.medicationReference?.display ??
    null;

  const dosage = resource.dosageInstruction?.[0];
  const dose =
    dosage?.doseAndRate?.[0]?.doseQuantity
      ? `${dosage.doseAndRate[0].doseQuantity.value ?? ""} ${dosage.doseAndRate[0].doseQuantity.unit ?? ""}`.trim()
      : dosage?.text ?? null;

  const route = firstCoding(dosage?.route)?.display ?? dosage?.route?.text ?? null;
  const frequency = firstCoding(dosage?.timing?.code)?.display ?? null;

  return {
    source_system: sourceSystem,
    source_id: id,
    patient_source_id: refToSourceId(patientRef) ?? patientRef,
    encounter_source_id: encounterRef ? refToSourceId(encounterRef) : null,
    medication_display: medDisplay,
    code_system: medCoding?.system ?? null,
    code: medCoding?.code ?? null,
    dose,
    route,
    frequency,
    status: resource.status ?? null,
    prescriber_display: resource.requester?.display ?? null,
    started_at: resource.dispenseRequest?.validityPeriod?.start ?? resource.authoredOn ?? null,
    ended_at: resource.dispenseRequest?.validityPeriod?.end ?? null,
    fhir_resource_json: resource,
  };
}

export function mapDocumentReference(
  resource: FhirDocumentReference,
  sourceSystem: string,
): DocumentReferenceRow | null {
  const id = resource.id;
  if (!id) return null;

  const patientRef = resource.subject?.reference;
  if (!patientRef) return null;

  const encounterRef = resource.context?.encounter?.[0]?.reference ?? null;
  const typeCoding = firstCoding(resource.type);
  const content = resource.content?.[0];

  return {
    source_system: sourceSystem,
    source_id: id,
    patient_source_id: refToSourceId(patientRef) ?? patientRef,
    encounter_source_id: encounterRef ? refToSourceId(encounterRef) : null,
    type: typeCoding?.display ?? resource.type?.text ?? null,
    authored_at: resource.date ?? null,
    author_display: resource.author?.[0]?.display ?? null,
    content_url: content?.attachment?.url ?? null,
    content_text:
      content?.attachment?.data
        ? Buffer.from(content.attachment.data, "base64").toString("utf8")
        : null,
    fhir_resource_json: resource,
  };
}
