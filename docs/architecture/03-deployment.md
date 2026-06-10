# 03 — Deployment Topology

## Single-tenant per hospital

Each hospital is a fully isolated deployment. No shared data plane. No multi-tenant logic in MVP.

Per-hospital deployment:
- Dedicated PostgreSQL instance
- Dedicated object storage bucket
- Dedicated Keycloak realm (or hospital SSO federation)
- Dedicated Kubernetes namespace
- Dedicated TLS certificates
- Per-hospital configuration via Helm values

## Deployment options

The hospital chooses one of three deployment patterns:

### A. On-premise (preferred for tertiary hospitals)
- Hospital provides Kubernetes cluster or VM hosts
- We ship Helm charts + container images
- Hospital IT operates day to day; we provide 24/7 support
- Data never leaves hospital network

### B. Sovereign cloud (faster onboarding)
- Deployed in STC Cloud, Mobily Cloud, NCAR, Salam, or similar in-Kingdom provider
- We operate; hospital has audit access
- Network bridge from hospital to cloud via dedicated link or hospital-VPN

### C. Hybrid
- Data and core services on hospital infrastructure
- ML inference (foundation model) hosted in sovereign cloud
- Per-hospital evaluation of acceptable boundary

## In-Kingdom requirement (non-negotiable)

All patient data, derived data (embeddings, narratives, Q&A interactions), and audit logs must remain within the Kingdom of Saudi Arabia.

For foundation model inference:
- Use a provider with documented in-Kingdom inference endpoints, OR
- Self-host an open-weights model on in-Kingdom infrastructure

The choice is captured in `docs/build/01-stack.md` open questions.

## Environments (per hospital tenant)

| Environment | Purpose | Data |
|---|---|---|
| `dev` | Engineering development | Synthetic / public FHIR test data only |
| `staging` | Pre-prod testing | De-identified hospital data (with hospital DPO approval) |
| `prod` | Live hospital use | Real PHI under PDPL and hospital governance |

## Networking

- All HTTPS, TLS 1.3 only, modern cipher suites
- mTLS between internal services (core ↔ narrative, core ↔ qa)
- API gateway is the only externally reachable endpoint (within hospital LAN/VPN)
- No public internet exposure of any tier
- Egress allowlist for foundation model endpoints only

## Resource sizing (MVP, single tenant, ~500 active clinicians, ~5000 patients/day)

| Component | Replicas | CPU/replica | Memory/replica | Notes |
|---|---|---|---|---|
| web | 2 | 0.5 vCPU | 512 MiB | Static + SSR |
| core | 3 | 2 vCPU | 4 GiB | Stateless |
| narrative | 2 | 2 vCPU | 8 GiB | LLM client + filter |
| qa | 3 | 2 vCPU | 8 GiB | Higher traffic than narrative |
| PostgreSQL primary | 1 | 4 vCPU | 16 GiB | + 1 read replica |
| Keycloak | 2 | 1 vCPU | 2 GiB | HA |

Foundation model and embedding model resources depend on choice (open question).
