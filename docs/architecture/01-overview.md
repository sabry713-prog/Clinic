# 01 — Architecture Overview

## High-level diagram (ASCII)

```
┌─────────────────────────────────────────────────────────────────┐
│  CLINICIAN WORKSTATION (browser, hospital LAN / VPN only)       │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ HTTPS (TLS 1.3)
┌─────────────────────────────────▼───────────────────────────────┐
│  API GATEWAY                                                    │
│  - Authentication (OIDC bearer)                                 │
│  - Rate limiting                                                │
│  - Request logging                                              │
└──────┬──────────────────────────────────────────────┬───────────┘
       │ gRPC + REST                                  │
┌──────▼─────────────┐  ┌────────────────────┐  ┌────▼─────────────┐
│ CORE SERVICE       │  │ NARRATIVE SERVICE  │  │ Q&A SERVICE      │
│ (Node.js/NestJS)   │  │ (Python)           │  │ (Python)         │
│ - Patient view     │  │ - Prompt assembly  │  │ - Classifier     │
│ - Auth & RBAC      │  │ - Model call       │  │ - Retrieval      │
│ - Audit logging    │  │ - Blocklist filter │  │ - Answer synth   │
│ - Handoff          │  │ - Provenance       │  │ - Blocklist      │
└──────┬─────────────┘  └────────┬───────────┘  └────────┬─────────┘
       │                         │                       │
       │                         └────────┬──────────────┘
       │                                  │
┌──────▼──────────────────────────────────▼─────────────────────────┐
│  DATA LAYER (all in-Kingdom)                                      │
│  - PostgreSQL (relational + JSONB for FHIR + pgvector)            │
│  - Object storage (S3-compatible, in-Kingdom)                     │
│  - Audit log (append-only PostgreSQL + WORM replica)              │
└──────┬────────────────────────────────────────────────────────────┘
       │
┌──────▼────────────────────────────────────────────────────────────┐
│  INTEGRATION LAYER                                                │
│  - FHIR R4 client (TypeScript)                                    │
│  - HL7 v2 adapter (Mirth Connect)                                 │
│  - Identity reconciliation                                        │
└──────┬────────────────────────────────────────────────────────────┘
       │ Hospital network only
┌──────▼────────────────────────────────────────────────────────────┐
│  HOSPITAL SOURCE SYSTEMS                                          │
│  EHR · LIS · RIS · PACS · Pharmacy · ADT                          │
└───────────────────────────────────────────────────────────────────┘
```

## Tier responsibilities

### Presentation tier
- **Web frontend** (React + TypeScript): clinician UI, admin console, Q&A conversational interface. No PWA / mobile native for MVP.

### Application tier
- **API gateway**: Kong or Envoy. Handles auth, rate limits, routing.
- **Core service** (Node.js/NestJS, TypeScript): business logic, patient view aggregation, RBAC, audit log writes, handoff generation, orchestration of narrative and Q&A services.
- **Narrative service** (Python, FastAPI): assembles deterministic narrative summaries via retrieval + LLM, runs blocklist filter, attaches provenance.
- **Q&A service** (Python, FastAPI): classifies queries, retrieves grounding records, synthesizes grounded answers OR returns refusal, runs blocklist filter.

### Data tier
- **PostgreSQL**: relational entities, FHIR resource JSONB blobs, pgvector for embeddings, audit log table.
- **Object storage**: documents, exports, WORM audit replica.

### Integration tier
- **FHIR client**: outbound only. Reads from EHR/LIS/pharmacy.
- **HL7 v2 adapter**: legacy fallback only where FHIR not available.
- **Identity reconciliation**: deterministic matcher with quarantine queue.

## Cross-cutting concerns

- **Authentication**: OIDC bearer tokens issued by Keycloak (self-hosted) or hospital SSO. JWT validation at API gateway.
- **Authorization**: RBAC at API layer. Patient access is filtered by care-team / ward assignment derived from FHIR Encounter resources.
- **Audit logging**: every request writes to append-only `audit_event` table. Hash-chained for tamper evidence. Replicated to WORM object storage daily.
- **Observability**: OpenTelemetry tracing on every request. Structured JSON logs (no PHI). Metrics exported to Prometheus / Grafana.

## Trust boundaries

| Boundary | Description |
|---|---|
| **Hospital ↔ Product** | Hospital network or VPN only. No public internet exposure. |
| **API Gateway ↔ Services** | mTLS between gateway and internal services |
| **Services ↔ Data** | Database credentials per-service via secret manager |
| **Services ↔ External Model** | Only in-Kingdom inference endpoints. Per-call audit. No raw PHI in prompts where possible (use structured retrieval results). |

## Non-goals for MVP

- Multi-tenant SaaS (each hospital = isolated single-tenant deployment)
- Mobile native apps
- Imaging viewer
- Genomics integration
- Patient-facing UI
- Cross-patient queries
- Real-time vital streaming
