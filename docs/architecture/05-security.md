# 05 — Security Architecture

## Identity and authentication

- **Primary**: Hospital SSO via OIDC (preferred) or SAML 2.0
- **Fallback**: Self-hosted Keycloak with username + password + TOTP MFA
- **Tokens**: JWT bearer, RS256-signed, 15-minute access token, 8-hour refresh token
- **Session timeout**: 15 min inactivity (configurable 5-60 min per hospital)
- **Failed login lockout**: 5 failures → 15 min lockout, then 1 hour, then admin unlock

## Authorization (RBAC)

Role-based, with patient scope further filtered by clinical relationship.

| Role | Patient scope | Capabilities |
|---|---|---|
| `physician` | Care team / ward assignment from FHIR Encounter | Read, narrative, Q&A, handoff |
| `pharmacist` | Pharmacy review queue | Read, Q&A |
| `nurse` | Ward assignment | Read, handoff, Q&A |
| `hospital_admin` | None (no clinical data) | User mgmt, audit review, config |
| `sysadmin` | None (no clinical data) | Infra, deploy, monitoring |

Authorization is enforced at the API layer. UI hiding is for UX, never for security.

### Patient scope derivation

1. Pull active Encounter resources for the user from FHIR
2. Extract patient IDs from those encounters
3. For ward-based scope: pull patients from all encounters with location matching user's ward assignment

Cache scope for 5 minutes; invalidate on user role change.

### Break-glass

Authorized roles can request access to a patient outside their normal scope with:
- A documented reason (free text, mandatory)
- Real-time notification to hospital admin
- Time-limited access (default 4 hours)
- Audit event marked with BREAK_GLASS flag

## Encryption

| Data | In transit | At rest |
|---|---|---|
| All API traffic | TLS 1.3 | n/a |
| Service-to-service | mTLS | n/a |
| PostgreSQL | TLS to client | TDE (transparent data encryption) |
| Object storage | TLS | AES-256 server-side encryption |
| Backup files | Encrypted in transit | Encrypted at rest with separate KMS key |
| Audit log | TLS | TDE + WORM replica encrypted separately |

## Key management

- Hospital-controlled keys preferred where supported
- Otherwise managed KMS (in-Kingdom)
- 90-day rotation policy
- Per-environment keys (no dev keys in prod)
- Master keys never exposed to application code

## Secrets management

- Secrets stored in HashiCorp Vault or equivalent
- Injected as environment variables at container start
- Never committed to repository
- Rotated quarterly

## PHI handling rules

1. **Never** log PHI to application logs. Use IDs, codes, and event types only.
2. **Never** include PHI in URLs (query strings, path params beyond opaque IDs).
3. **Never** send PHI to external services that lack:
   - In-Kingdom processing guarantee
   - Contractual no-training-on-data clause
   - Documented sub-processor lineage
4. **Audit** every PHI access.
5. **Minimize** retention — audio recordings would have been 90 days but voice is now out of scope; Q&A interaction text is retained for the patient record lifetime.

## Audit log integrity

```
audit_event:
  id              uuid
  ts              timestamptz
  actor_id        uuid
  actor_role      text
  action          text  (e.g., PATIENT_VIEW, QA_REQUEST, QA_ANSWERED, QA_REFUSED)
  target_type     text  (e.g., PATIENT)
  target_id       uuid
  outcome         text  (SUCCESS, FAILURE, REFUSED)
  metadata_json   jsonb (no PHI)
  hash_prev       text  (hex SHA-256 of previous row)
  hash_self       text  (SHA-256 of canonical bytes of this row including hash_prev)
```

- INSERT-only constraint enforced via PostgreSQL trigger
- Row deletion / update revokes user grants at deployment
- Daily WORM replica to object storage
- Quarterly integrity verification job (replay hash chain)

## Vulnerability and patch management

- Dependency scan: every CI run (npm audit, pip-audit, Trivy on container images)
- SAST: Semgrep on every PR
- DAST: OWASP ZAP scheduled scan weekly against staging
- Penetration test: third party, quarterly during MVP, annually post-launch
- Critical CVE response: 24h to patch + redeploy

## NCA ECC alignment

Map each implemented control to an ECC requirement. Maintain a control register in `/docs/ops/ecc-control-register.md` (to be created during Slice 0).

## PDPL compliance integration

- DPIA completed and signed before any production deployment
- Data subject access endpoint (`/api/v1/dsr/access`)
- Data subject erasure endpoint (`/api/v1/dsr/erase`) — note: erasure must respect medical record retention requirements
- Breach notification procedure documented, tested in tabletop annually
- Sub-processor list maintained and approved by hospital DPO
