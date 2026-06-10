# 01 — Tech Stack

## Stack at a glance

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite | Mature ecosystem, fast dev loop |
| Frontend styling | Tailwind CSS + Radix primitives | Speed, accessibility, RTL support |
| Frontend state | Zustand + React Query | Lightweight, server state separation |
| Frontend i18n | i18next | Mature Arabic + English support, RTL |
| Backend core | NestJS (Node.js 20, TypeScript) | Structured, opinionated, DI built in |
| Backend ML services | Python 3.12 + FastAPI | ML/LLM ecosystem |
| ORM | Prisma | Type-safe, migrations, good ergonomics |
| Inter-service RPC | gRPC | Strongly typed, efficient |
| Database | PostgreSQL 16 + pgvector | One DB to operate, vector + relational together |
| Object storage | S3-compatible (MinIO dev / Saudi cloud prod) | Standard |
| Identity | Keycloak (self-hosted) | Open source, OIDC + SAML, federation |
| API gateway | Envoy | Cloud-native, mTLS, rate limiting |
| Queue | PostgreSQL LISTEN/NOTIFY + pg-boss | Avoid Redis dependency for MVP |
| Container runtime | Docker / containerd | Standard |
| Orchestration | Kubernetes (production), Docker Compose (dev) | |
| IaC | Terraform + Helm | Standard |
| Observability | OpenTelemetry → Grafana stack | Open standards |
| CI/CD | GitHub Actions (or GitLab CI) | TBD based on repo choice |
| Secrets | HashiCorp Vault (production), .env files (dev only) | |

## Why not other choices

- **Not Python for core**: Node.js/NestJS is fine here, faster for I/O-heavy patient view aggregation, type-safe via TypeScript. Python is reserved for ML services where the ecosystem is much stronger.
- **Not Redis** in MVP: PostgreSQL handles queues, cache, and primary store. One less moving part. Add Redis when scale demands it.
- **Not Elasticsearch/OpenSearch in MVP**: PostgreSQL full-text search + pgvector covers our needs. Add a dedicated search stack later if needed.
- **Not Next.js**: We want a clear SPA boundary with a separately-deployable API. Vite + React keeps things simple.
- **Not multi-tenant SaaS**: Single-tenant per hospital makes compliance, data residency, and deployment far simpler. Multi-tenancy can come later if/when business model justifies.

## Foundation model — open question

The foundation model choice depends on Q-4 (in-Kingdom inference, no-training-on-data, Arabic capability). Options to evaluate before Slice 2:

1. **Anthropic Claude** via in-Kingdom partner deployment (if available)
2. **Open-weights model self-hosted** (e.g., Qwen, Llama, Falcon, Saudi-trained model) — full control, higher ops burden
3. **GCC-hosted commercial API** (e.g., G42 / Inception models)
4. **Hospital-provided inference** if hospital has its own ML platform

The choice is captured in `apps/narrative/model_client.py` and `apps/qa/model_client.py` behind a thin abstraction. Migration cost between providers is low if the abstraction is respected.

## Embedding model — open question

Same considerations as foundation model. Likely a different vendor than the foundation model. Common open-weights multilingual options:
- BGE-M3 (multilingual, strong on Arabic)
- E5-multilingual
- Cohere multilingual (if available in-Kingdom)

Dimension matters for `hospital.retrieval_chunk.embedding` column type. Plan for 1024-dim by default; change is a schema migration.

## Versions

- Node.js 20 LTS
- Python 3.12
- PostgreSQL 16
- React 18
- TypeScript 5.3+

Lock all major versions; treat dependency updates as a separate compliance-tracked workstream.

## Repo strategy

Monorepo using:
- **pnpm workspaces** for Node.js / TypeScript packages
- **uv** for Python apps and packages
- **Turborepo** or **Nx** for build orchestration (choose during Slice 0)

```
/
├── pnpm-workspace.yaml
├── turbo.json
├── apps/
│   ├── web/                pnpm
│   ├── core/               pnpm
│   ├── narrative/          uv (Python)
│   └── qa/                 uv (Python)
└── packages/
    ├── fhir-client/        pnpm
    ├── shared-types/       pnpm
    ├── audit/              pnpm
    ├── classifier/         uv
    ├── retrieval/          uv
    └── blocklist/          uv
```
