# 01 — Environments

## Three environments, one hospital

Each hospital tenant has three environments. They are isolated; promotion between them is explicit.

| Env | Purpose | Data | Access |
|---|---|---|---|
| `dev` | Engineering development | Synthetic only (Synthea, HAPI sandbox) | Engineering team |
| `staging` | Pre-prod testing | De-identified hospital data **with DPO approval** | Engineering + clinical advisor + hospital tech lead |
| `prod` | Live clinical use | Real PHI under PDPL + hospital governance | Authorized clinicians + admin only |

There is **no shared `dev`/`staging`/`prod` across hospitals**. Each hospital is its own tenant, end to end.

## Environment parity

The same Helm charts and container images deploy to all three environments. Differences are configuration only:

- Database connection strings
- Foundation model endpoint (may be stub in dev)
- OIDC issuer (Keycloak in dev/staging; hospital SSO in prod)
- Feature flags
- Resource limits

No "prod-only code paths." If staging passes, prod will pass.

## Configuration management

- **Container images**: immutable; same image promoted dev → staging → prod
- **Config**: per-environment values in `infra/helm/values-{env}.yaml`
- **Secrets**: never in Git. Pulled from Vault at container start.
- **Feature flags**: managed centrally; defaults in code but overridable per env

## Promotion process

```
PR merged to main
  → CI builds container image with git SHA tag
  → Image pushed to in-Kingdom registry
  → Auto-deploy to dev
  → After smoke + integration tests pass:
       manual approval gate → deploy to staging
  → After staging soak (24-48h) + sign-off:
       manual approval gate → deploy to prod
```

Production deploys require:
- Engineering on-call ack
- Clinical advisor ack (if any prompt / classifier / blocklist change)
- Change ticket in the hospital's change management system

## Database environments

- Each environment has its own PostgreSQL instance (or schema if budget-constrained in dev only)
- Migrations are forward-only; apply in dev → staging → prod
- **No prod data ever copied to staging or dev.** If we need realistic data shape, generate synthetic data that mirrors the structure.

## Stub mode in non-prod

`dev` defaults to stub mode for foundation model and embedding model so engineers can work without external dependencies and without spending API credits.

`staging` uses the real model endpoint to validate latency and behavior under realistic conditions.

`prod` always uses the real, contracted model endpoint.

## Test data in dev/staging

Sources allowed:
- HAPI FHIR public test server (`hapi.fhir.org`) for dev only
- Synthea-generated bundles (hand-imported to local FHIR server)
- Hand-crafted Arabic clinical scenarios

Sources forbidden:
- Any real hospital data without explicit DPO approval, even partial
- Any third-party "demo" dataset that may contain real PHI

## Deployment topology per environment

| Env | Hosting |
|---|---|
| `dev` | Single Kubernetes node or Docker Compose on engineer's machine; or shared dev cluster in sovereign cloud |
| `staging` | Single-tenant cluster mirroring prod, in the same hospital's preferred environment (on-prem or sovereign cloud) |
| `prod` | Hospital's chosen deployment per `docs/architecture/03-deployment.md` |

## Network isolation

- Dev: no PHI exposure; can use public-internet FHIR sandbox
- Staging: hospital LAN / VPN only; no public internet ingress
- Prod: hospital LAN / VPN only; firewall-restricted egress to allowlisted endpoints (foundation model only)
