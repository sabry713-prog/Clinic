# 03 — Patient API

## GET /api/v1/patients

List patients in current user's scope.

**Query params:**
- `cursor` — pagination cursor
- `limit` — 1-100, default 20
- `q` — free-text search across patient name and MRN (not clinical data)
- `ward_id` — filter by ward

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "mrn": "AB-4488721",
      "display_name": "Abdullah Al-...",
      "age_years": 68,
      "sex": "male",
      "current_encounter": {
        "id": "uuid",
        "type": "inpatient",
        "admitted_at": "2026-05-22T14:30:00+03:00",
        "ward": "IM-3B",
        "bed": "12",
        "attending_display_name": "Dr. ..."
      }
    }
  ],
  "pagination": { ... }
}
```

## GET /api/v1/patients/:id

Aggregated patient view.

**Response (truncated, illustrative):**
```json
{
  "patient": {
    "id": "uuid",
    "mrn": "AB-4488721",
    "national_id_masked": "1********9",
    "display_name": "Abdullah Al-...",
    "date_of_birth": "1958-03-14",
    "age_years": 68,
    "sex": "male",
    "preferred_language": "ar",
    "weight_kg": 82,
    "height_cm": 171,
    "source": {
      "system": "EHR",
      "last_updated": "2026-05-25T07:50:00+03:00"
    }
  },
  "current_encounter": { ... },
  "allergies": [
    {
      "id": "uuid",
      "code": { "system": "RxNorm", "code": "...", "display": "Penicillin" },
      "reaction": "rash",
      "recorded_at": "2019-04-15",
      "source": { "system": "EHR", "last_updated": "..." }
    }
  ],
  "problems": [
    {
      "id": "uuid",
      "code": { "system": "ICD-10", "code": "E11.9", "display": "Type 2 Diabetes Mellitus" },
      "onset_date": "2014-...",
      "status": "active",
      "source": { ... }
    }
  ],
  "medications": [
    {
      "id": "uuid",
      "code": { "system": "RxNorm", "code": "...", "display": "Metformin 500 mg PO" },
      "dose": "500 mg",
      "route": "PO",
      "frequency": "BID",
      "started_at": "...",
      "status": "active",
      "source": { ... }
    }
  ],
  "recent_observations": {
    "vitals": [ /* most recent N vitals */ ],
    "labs": [ /* most recent N labs by code */ ]
  },
  "recent_documents": [
    {
      "id": "uuid",
      "type": "progress_note",
      "authored_at": "2026-05-24T15:00:00+03:00",
      "author_display_name": "Dr. ...",
      "url": "/api/v1/patients/:id/documents/:doc_id"
    }
  ],
  "prior_admissions": [
    {
      "id": "uuid",
      "admitted_at": "2025-02-11T...",
      "discharged_at": "2025-02-15T...",
      "admitting_diagnosis_display": "Acute kidney injury on CKD"
    }
  ]
}
```

**Important:**
- All fields are factual reproductions from source systems.
- No `severity_indicator`, `priority`, `alert_flag`, or similar field.
- Lab reference ranges shown only as provided by the source LIS.
- No color-coding hints in the response.

**Errors:**
- 403 PATIENT_OUT_OF_SCOPE
- 404 NOT_FOUND

## GET /api/v1/patients/:id/observations

Observations (labs, vitals) with filters.

**Query params:**
- `code` — repeated, LOINC/SNOMED code
- `category` — `laboratory` | `vital-signs` | `imaging` | etc.
- `since` — ISO date
- `until` — ISO date
- `cursor`, `limit`

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "code": { "system": "LOINC", "code": "2160-0", "display": "Creatinine" },
      "value": 168,
      "unit": "μmol/L",
      "reference_range": { "low": 59, "high": 104 },  // as provided by LIS
      "effective_at": "2026-05-24T06:15:00+03:00",
      "status": "final",
      "source": { ... }
    }
  ],
  "pagination": { ... }
}
```

## GET /api/v1/patients/:id/medications

Medications.

**Query params:**
- `status` — `active` | `completed` | `stopped` | `all` (default `active`)
- `since`, `until`

Response shape similar to `medications` array above.

## GET /api/v1/patients/:id/conditions/:condition_id/history

All documented episodes of the same coded condition (same `code_system` + `code`)
for this patient, newest first. Each episode is linked — by record date — to the
encounter and the clinical note documented that day, when present. Factual
reproduction only: no grouping by severity, no episode interpretation.

**Response:**
```json
{
  "code": { "system": "http://snomed.info/sct", "code": "41652007", "display": "Eye pain" },
  "episodes": [
    {
      "id": "uuid",
      "status": "resolved",
      "onset_date": "2025-06-11",
      "encounter": { "id": "uuid", "ward": "Ophthalmology Clinic", "started_at": "..." },
      "note": {
        "id": "uuid",
        "type": "Clinic visit note",
        "authored_at": "...",
        "author_display": "Dr. ...",
        "content_text": "..."
      }
    }
  ]
}
```

`encounter` / `note` are `null` when no record exists for that date.

**Errors:**
- 403 PATIENT_OUT_OF_SCOPE
- 404 NOT_FOUND (condition does not exist or belongs to another patient)

Audit action: `PATIENT_CONDITION_HISTORY_VIEW`.

## GET /api/v1/patients/:id/documents/:doc_id

Returns full document content (e.g., progress notes). Document body is returned verbatim from the source system.

## GET /api/v1/patients/:id/encounters

List of all encounters for the patient.
