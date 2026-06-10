/**
 * Minimal FHIR R4 TypeScript types sufficient for ingestion use-cases.
 * Not a complete FHIR spec implementation — only fields we actually use.
 */

export interface FhirResource {
  readonly resourceType: string;
  readonly id?: string;
}

export interface FhirBundle<T extends FhirResource = FhirResource> {
  readonly resourceType: "Bundle";
  readonly id?: string;
  readonly total?: number;
  readonly link?: readonly FhirBundleLink[];
  readonly entry?: ReadonlyArray<FhirBundleEntry<T>>;
}

export interface FhirBundleLink {
  readonly relation: string;
  readonly url: string;
}

export interface FhirBundleEntry<T extends FhirResource = FhirResource> {
  readonly fullUrl?: string;
  readonly resource?: T;
}

export interface FhirCoding {
  readonly system?: string;
  readonly code?: string;
  readonly display?: string;
}

export interface FhirCodeableConcept {
  readonly coding?: readonly FhirCoding[];
  readonly text?: string;
}

export interface FhirIdentifier {
  readonly use?: string;
  readonly type?: FhirCodeableConcept;
  readonly system?: string;
  readonly value?: string;
}

export interface FhirHumanName {
  readonly use?: string;
  readonly text?: string;
  readonly family?: string;
  readonly given?: readonly string[];
}

export interface FhirPeriod {
  readonly start?: string;
  readonly end?: string;
}

export interface FhirReference {
  readonly reference?: string;
  readonly display?: string;
}

export interface FhirQuantity {
  readonly value?: number;
  readonly unit?: string;
  readonly system?: string;
  readonly code?: string;
}

export interface FhirRange {
  readonly low?: FhirQuantity;
  readonly high?: FhirQuantity;
}

export interface FhirObservationReferenceRange {
  readonly low?: FhirQuantity;
  readonly high?: FhirQuantity;
  readonly text?: string;
}

export interface FhirAnnotation {
  readonly text?: string;
  readonly time?: string;
}

export interface FhirPatient extends FhirResource {
  readonly resourceType: "Patient";
  readonly identifier?: readonly FhirIdentifier[];
  readonly name?: readonly FhirHumanName[];
  readonly gender?: string;
  readonly birthDate?: string;
  readonly communication?: ReadonlyArray<{
    readonly language?: FhirCodeableConcept;
    readonly preferred?: boolean;
  }>;
}

export interface FhirEncounterParticipant {
  readonly type?: readonly FhirCodeableConcept[];
  readonly individual?: FhirReference;
}

export interface FhirEncounterLocation {
  readonly location?: FhirReference;
  readonly status?: string;
}

export interface FhirEncounter extends FhirResource {
  readonly resourceType: "Encounter";
  readonly status?: string;
  readonly class?: FhirCoding;
  readonly subject?: FhirReference;
  readonly period?: FhirPeriod;
  readonly participant?: readonly FhirEncounterParticipant[];
  readonly location?: readonly FhirEncounterLocation[];
}

export interface FhirObservation extends FhirResource {
  readonly resourceType: "Observation";
  readonly status?: string;
  readonly category?: readonly FhirCodeableConcept[];
  readonly code?: FhirCodeableConcept;
  readonly subject?: FhirReference;
  readonly encounter?: FhirReference;
  readonly effectiveDateTime?: string;
  readonly effectivePeriod?: FhirPeriod;
  readonly valueQuantity?: FhirQuantity;
  readonly valueString?: string;
  readonly valueCodeableConcept?: FhirCodeableConcept;
  readonly referenceRange?: readonly FhirObservationReferenceRange[];
}

export interface FhirAllergyReaction {
  readonly manifestation?: readonly FhirCodeableConcept[];
  readonly severity?: string;
}

export interface FhirAllergyIntolerance extends FhirResource {
  readonly resourceType: "AllergyIntolerance";
  readonly patient?: FhirReference;
  readonly code?: FhirCodeableConcept;
  readonly reaction?: readonly FhirAllergyReaction[];
  readonly recordedDate?: string;
  readonly clinicalStatus?: FhirCodeableConcept;
}

export interface FhirCondition extends FhirResource {
  readonly resourceType: "Condition";
  readonly subject?: FhirReference;
  readonly code?: FhirCodeableConcept;
  readonly clinicalStatus?: FhirCodeableConcept;
  readonly onsetDateTime?: string;
  readonly onsetPeriod?: FhirPeriod;
}

export interface FhirDosageInstruction {
  readonly text?: string;
  readonly route?: FhirCodeableConcept;
  readonly timing?: {
    readonly code?: FhirCodeableConcept;
    readonly repeat?: {
      readonly frequency?: number;
      readonly period?: number;
      readonly periodUnit?: string;
    };
  };
  readonly doseAndRate?: ReadonlyArray<{
    readonly doseQuantity?: FhirQuantity;
  }>;
}

export interface FhirMedicationRequest extends FhirResource {
  readonly resourceType: "MedicationRequest";
  readonly status?: string;
  readonly subject?: FhirReference;
  readonly encounter?: FhirReference;
  readonly medicationCodeableConcept?: FhirCodeableConcept;
  readonly medicationReference?: FhirReference;
  readonly requester?: FhirReference;
  readonly dosageInstruction?: readonly FhirDosageInstruction[];
  readonly dispenseRequest?: {
    readonly validityPeriod?: FhirPeriod;
  };
  readonly authoredOn?: string;
}

export interface FhirDocumentReferenceContent {
  readonly attachment?: {
    readonly url?: string;
    readonly data?: string;
    readonly contentType?: string;
    readonly title?: string;
  };
}

export interface FhirDocumentReference extends FhirResource {
  readonly resourceType: "DocumentReference";
  readonly status?: string;
  readonly type?: FhirCodeableConcept;
  readonly subject?: FhirReference;
  readonly context?: {
    readonly encounter?: readonly FhirReference[];
  };
  readonly date?: string;
  readonly author?: readonly FhirReference[];
  readonly content?: readonly FhirDocumentReferenceContent[];
  readonly description?: string;
}
