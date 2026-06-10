# 01 — API Conventions

## Base URL

`https://{hospital-tenant}.{domain}/api/v1`

## Authentication

Every request requires a Bearer JWT in `Authorization` header:
```
Authorization: Bearer <jwt>
```

Token validation at API gateway. Failed validation → 401.

## Content type

- Requests: `application/json` unless specified
- Responses: `application/json; charset=utf-8`

## Versioning

URL-based versioning: `/api/v1`, `/api/v2`. We are on v1 for MVP. Breaking changes require new version.

## Pagination

Query params: `?cursor=<opaque>&limit=<n>` (limit 1-100, default 20).
Response includes:
```json
{
  "data": [...],
  "pagination": {
    "next_cursor": "..." | null,
    "has_more": true | false
  }
}
```

## Standard error response

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Human-readable error.",
    "details": {},        // optional additional structured info
    "trace_id": "..."     // for support / debugging
  }
}
```

### Standard error codes

| HTTP | Code | When |
|---|---|---|
| 400 | INVALID_REQUEST | Schema validation failed |
| 401 | UNAUTHENTICATED | Missing or invalid token |
| 403 | FORBIDDEN | Auth ok, but no permission |
| 403 | PATIENT_OUT_OF_SCOPE | User cannot access this patient |
| 404 | NOT_FOUND | Resource does not exist |
| 409 | CONFLICT | State conflict (e.g., concurrent edit) |
| 422 | UNPROCESSABLE | Valid schema, invalid semantics |
| 429 | RATE_LIMITED | Too many requests |
| 500 | INTERNAL_ERROR | Server error (logged with trace_id) |
| 503 | UPSTREAM_UNAVAILABLE | Source system unavailable |

## Idempotency

POST endpoints that have side effects accept `Idempotency-Key` header (UUID). Same key + same body within 24h returns cached response.

## Rate limiting

Per-user: 600 requests / min.
Q&A endpoint: 30 questions / min per user.
Returned headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

## Audit headers

Every response includes:
- `X-Audit-Event-Id` — the audit event ID created for this request
- `X-Trace-Id` — distributed trace ID

## Localization

- Request `Accept-Language: ar` or `Accept-Language: en` — applies to UI strings in responses (refusal messages, system labels)
- Clinical data is returned in source form (not translated)
- Default: hospital configuration default (typically `ar`)

## Date and time

- All timestamps ISO 8601 UTC with timezone offset
- All clinical dates preserved as recorded in source system (no normalization)
- Display in user's locale handled by client
