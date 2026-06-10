# 02 — FHIR Mapping

## Source → Internal

We mirror FHIR resources into the `hospital` schema with both flattened fields (for query performance) and the full FHIR JSON (for completeness and audit).

### FHIR Patient → hospital.patient

| FHIR field | Internal field | Notes |
|---|---|---|
| `id` | `source_id` | Combined with `source_system` for uniqueness |
| `identifier[type=MR].value` | `mrn` | Medical record number |
| `identifier[type=NI].value` | `national_id_hash` | **Hashed** via SHA-256 before storage |
| `name.text` | `display_name` | Or assembled from given + family |
| `name.family` | `family_name` | |
| `name.given[0]` | `given_name` | |
| `birthDate` | `date_of_birth` | |
| `gender` | `sex` | Normalize `male`/`female`/`other`/`unknown` |
| `communication[preferred=true].language` | `preferred_language` | Default 'ar' for SA |
| (custom extension or Observation) | `weight_kg` | From latest body-weight observation |
| (custom extension or Observation) | `height_cm` | From latest body-height observation |

### FHIR Encounter → hospital.encounter

| FHIR | Internal |
|---|---|
| `id` | `source_id` |
| `subject.reference` | `patient_id` (resolved) |
| `class.code` | `encounter_type` |
| `status` | `status` |
| `period.start` | `started_at` |
| `period.end` | `ended_at` |
| `location[0].location.display` | `ward` |
| (custom or location chain) | `bed` |
| `participant[type=ATND].individual.reference` | `attending_user_id` (resolved) |

### FHIR Observation → hospital.observation

| FHIR | Internal |
|---|---|
| `id` | `source_id` |
| `subject.reference` | `patient_id` |
| `encounter.reference` | `encounter_id` |
| `category[0].coding[0].code` | `category` |
| `code.coding[0].system` | `code_system` |
| `code.coding[0].code` | `code` |
| `code.coding[0].display` or `code.text` | `code_display` |
| `valueQuantity.value` | `value_numeric` |
| `valueString` or `valueCodeableConcept.text` | `value_text` |
| `valueQuantity.unit` | `unit` |
| `referenceRange[0].low.value` | `ref_range_low` |
| `referenceRange[0].high.value` | `ref_range_high` |
| `referenceRange[0].text` | `ref_range_text` |
| `status` | `status` |
| `effectiveDateTime` or `effectivePeriod.start` | `effective_at` |

### FHIR AllergyIntolerance → hospital.allergy_intolerance

| FHIR | Internal |
|---|---|
| `id` | `source_id` |
| `patient.reference` | `patient_id` |
| `code.coding[0].system` | `code_system` |
| `code.coding[0].code` | `code` |
| `code.coding[0].display` or `code.text` | `code_display` |
| `reaction[0].manifestation[0].text` | `reaction` |
| `reaction[0].severity` | `severity` |
| `recordedDate` | `recorded_at` |

### FHIR Condition → hospital.condition

| FHIR | Internal |
|---|---|
| `id` | `source_id` |
| `subject.reference` | `patient_id` |
| `code.coding[0].system` | `code_system` |
| `code.coding[0].code` | `code` |
| `code.coding[0].display` or `code.text` | `code_display` |
| `clinicalStatus.coding[0].code` | `status` |
| `onsetDateTime` or `onsetPeriod.start` | `onset_date` |

### FHIR MedicationRequest → hospital.medication_request

| FHIR | Internal |
|---|---|
| `id` | `source_id` |
| `subject.reference` | `patient_id` |
| `encounter.reference` | `encounter_id` |
| `medicationCodeableConcept.coding[0].display` or `text` | `medication_display` |
| `medicationCodeableConcept.coding[0].system` | `code_system` |
| `medicationCodeableConcept.coding[0].code` | `code` |
| `dosageInstruction[0].doseAndRate[0].doseQuantity.value + unit` | `dose` |
| `dosageInstruction[0].route.text` | `route` |
| `dosageInstruction[0].timing.code.text` | `frequency` |
| `status` | `status` |
| `requester.display` | `prescriber_display` |
| `authoredOn` | `started_at` |

### FHIR DocumentReference → hospital.document_reference

| FHIR | Internal |
|---|---|
| `id` | `source_id` |
| `subject.reference` | `patient_id` |
| `context.encounter[0].reference` | `encounter_id` |
| `type.coding[0].display` | `type` |
| `date` | `authored_at` |
| `author[0].display` | `author_display` |
| `content[0].attachment.url` | `content_url` |
| (fetched inline if `content[0].attachment.data` present) | `content_text` |

## Code system handling

We store both system + code so that retrieval and display can use them. Common systems:

- LOINC: laboratory codes
- SNOMED CT: clinical concepts, conditions, allergies
- ICD-10 / ICD-10-CM: diagnoses
- RxNorm: medications
- NPHIES-specific value sets where required

## NPHIES profiles

When NPHIES Implementation Guides apply (mostly insurance-aligned), we validate inbound resources against the published StructureDefinitions and Profile resources. Validation failures are logged but do not block ingestion (we ingest with conformance warnings).

## Ingestion safety

- Hash fingerprint each resource on ingest (SHA-256 of canonical JSON) and skip if unchanged
- Capture `last_synced_at` per resource
- Bulk operations use SQL upserts (`INSERT ... ON CONFLICT ... DO UPDATE`)
- Never overwrite National ID hash without explicit reconciliation approval

## Identity reconciliation details

Patients are matched across source systems on a deterministic weighted feature score:

| Feature | Weight | Notes |
|---|---|---|
| National ID hash exact match | 60 | Strongest signal |
| MRN exact match within same source | 25 | Same hospital MRN system |
| Date of birth exact match | 8 | |
| Family + given name similarity > 0.9 | 5 | Phonetic + Levenshtein |
| Sex match | 2 | |

Total possible: 100.

- ≥ 95: auto-merge
- 70–94: quarantine for human review
- < 70: treat as separate patients

National ID hash mismatch + everything else matching is automatic quarantine (potential identity fraud or data quality issue).
