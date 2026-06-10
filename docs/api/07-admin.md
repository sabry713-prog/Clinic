# 07 — Admin & Audit Endpoints

## Users

### GET /api/v1/admin/users
List users in tenant. Hospital admin role required.

### POST /api/v1/admin/users
Create a user (typically auto-provisioned via SSO; manual creation only for local IdP fallback).

### PATCH /api/v1/admin/users/:id
Update roles or scope. Triggers audit event ROLE_CHANGED.

### DELETE /api/v1/admin/users/:id
Disable user. Soft delete; record retained in audit log.

## Audit

### GET /api/v1/admin/audit
Search audit log.

**Query params:**
- `actor_id` — filter by user
- `target_type` — `PATIENT`, `USER`, `CONFIG`, etc.
- `target_id` — UUID
- `action` — `PATIENT_VIEW`, `QA_REQUEST`, `QA_ANSWERED`, `QA_REFUSED`, `NARRATIVE_GENERATED`, `HANDOFF_GENERATED`, `LOGIN_SUCCESS`, `LOGIN_FAILURE`, `ROLE_CHANGED`, `BREAK_GLASS_ACCESS`, etc.
- `since`, `until` — ISO timestamps
- `outcome` — `SUCCESS`, `FAILURE`, `REFUSED`
- `cursor`, `limit`

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "ts": "...",
      "actor": {
        "id": "uuid",
        "display_name": "Dr. ...",
        "role": "physician"
      },
      "action": "QA_REFUSED",
      "target_type": "PATIENT",
      "target_id": "uuid",
      "outcome": "REFUSED",
      "metadata": {
        "question_text": "Is the kidney function getting worse?",
        "refusal_category": "TREND_INTERPRETATION",
        "classifier_confidence": 0.99,
        "rule_matches": ["TREND_INTERPRETATION:is_X_getting_worse"]
      }
    }
  ],
  "pagination": { ... }
}
```

### POST /api/v1/admin/audit/verify
Run hash-chain integrity verification.

**Response:**
```json
{
  "started_at": "...",
  "finished_at": "...",
  "events_verified": 124573,
  "integrity_violations": [],  // empty array on success
  "passed": true
}
```

### GET /api/v1/admin/audit/export
Export filtered audit log as CSV / JSON for compliance review.

## Identity reconciliation

### GET /api/v1/admin/reconciliation/quarantine
List quarantined identity matches awaiting human resolution.

### POST /api/v1/admin/reconciliation/:id/resolve
Resolve a quarantined match.

**Request body:**
```json
{
  "action": "merge" | "keep_separate" | "mark_duplicate",
  "reason": "string"
}
```

## Configuration

### GET /api/v1/admin/config
Hospital-level configuration (session timeout, retention periods within bounds, etc.)

### PATCH /api/v1/admin/config
Update configuration. Audit logged.

## Data subject rights (PDPL)

### POST /api/v1/dsr/access
Submit a data subject access request.

### POST /api/v1/dsr/erase
Submit erasure request (subject to medical record retention requirements).

### GET /api/v1/dsr/:request_id
Check request status.
