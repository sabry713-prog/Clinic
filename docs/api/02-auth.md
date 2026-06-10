# 02 — Auth Endpoints

## OIDC redirect flow

We use OIDC Authorization Code Flow with PKCE. The frontend redirects to the IdP; the IdP redirects back with a code; the backend exchanges code for tokens and sets HTTP-only cookies.

### POST /api/v1/auth/login

Initiates OIDC login.

**Request:**
```json
{
  "return_to": "/patient/123"  // optional, defaults to /
}
```

**Response:**
```json
{
  "auth_url": "https://idp.hospital.sa/auth?..."
}
```

Client redirects to `auth_url`.

### GET /api/v1/auth/callback

OIDC callback. Exchanges code for tokens. Sets cookies.

**Query params:** `code`, `state`

**Response:** 302 redirect to `return_to` URL captured at login.

Sets:
- `session_id` HTTP-only secure cookie (server-side session lookup)

### POST /api/v1/auth/logout

Revokes session and signs out from IdP.

**Response:**
```json
{
  "logout_url": "https://idp.hospital.sa/logout?..."
}
```

### GET /api/v1/auth/me

Returns current authenticated user.

**Response:**
```json
{
  "id": "uuid",
  "external_subject": "string",
  "display_name": "Dr. Abdullah Al-...",
  "email": "...",
  "preferred_language": "ar" | "en",
  "roles": ["physician"],
  "permissions": [
    "patient:read",
    "narrative:generate",
    "qa:ask",
    "handoff:generate"
  ],
  "patient_scope": {
    "type": "care_team",
    "ward_ids": ["ward-3b"],
    "count": 14
  }
}
```

### POST /api/v1/auth/refresh

Refreshes session.

**Response:** 204 No Content (refreshed via cookie rotation).

## Local IdP fallback (Keycloak)

Used only when hospital SSO is unavailable. Same endpoints; IdP is Keycloak instead of hospital SSO. Requires TOTP MFA on first login.
