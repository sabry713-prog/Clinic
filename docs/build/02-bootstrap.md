# 02 — Project Bootstrap

This document is the step-by-step setup guide for the repo. Read once; then everything below should "just work."

## Prerequisites

Install on your development machine:

- **Node.js 20 LTS** (use `nvm` or `volta`)
- **pnpm 9+** (`npm install -g pnpm`)
- **Python 3.12** with **uv** (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- **Docker** + **Docker Compose**
- **PostgreSQL 16 client** (`psql`) for local connections
- **Git LFS** (for any large fixture files)

Optional but useful:
- **just** task runner (`brew install just`) — replaces a long `Makefile`
- **direnv** for per-project env vars

## One-time repository setup

```bash
git clone <repo-url> clinical-copilot && cd clinical-copilot

# Top-level workspace install
pnpm install                     # all Node.js workspaces

# Python apps (one per app)
cd apps/narrative && uv sync && cd ../..
cd apps/qa && uv sync && cd ../..

# Python packages
cd packages/classifier && uv sync && cd ../..
cd packages/retrieval && uv sync && cd ../..
cd packages/blocklist && uv sync && cd ../..

# Pre-commit hooks
pnpm exec husky install
```

## Local environment

The repo ships with `docker-compose.dev.yml` that starts:

- **PostgreSQL 16** with `pgvector` extension preinstalled (port 5432)
- **Keycloak** with a pre-seeded `dev` realm and test users (port 8080)
- **MinIO** for S3-compatible object storage (port 9000, console 9001)
- **Jaeger** for tracing (port 16686 UI)
- **Mailpit** for catching outbound email in dev (port 8025)

Start:
```bash
docker compose -f docker-compose.dev.yml up -d
```

Stop:
```bash
docker compose -f docker-compose.dev.yml down
```

Reset (wipes data):
```bash
docker compose -f docker-compose.dev.yml down -v
```

## Environment variables

Copy `.env.example` to `.env` at the repo root. Key vars:

```bash
# Database
DATABASE_URL=postgresql://app:app@localhost:5432/clinical_copilot

# Keycloak
OIDC_ISSUER_URL=http://localhost:8080/realms/dev
OIDC_CLIENT_ID=copilot-core
OIDC_CLIENT_SECRET=<dev-only-secret>

# Object storage (MinIO in dev)
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=clinical-copilot-dev

# Service ports
CORE_PORT=4000
NARRATIVE_GRPC_PORT=5001
QA_GRPC_PORT=5002
WEB_PORT=3000

# Foundation model (placeholder — set per chosen vendor)
FOUNDATION_MODEL_PROVIDER=stub      # 'stub' | 'anthropic' | 'self-hosted' | ...
FOUNDATION_MODEL_API_KEY=
FOUNDATION_MODEL_ENDPOINT=

# Embedding model
EMBEDDING_MODEL_PROVIDER=stub
EMBEDDING_MODEL_ENDPOINT=

# Observability
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# FHIR test endpoint (use HAPI public sandbox during early dev)
FHIR_BASE_URL=https://hapi.fhir.org/baseR4
FHIR_AUTH_MODE=none                 # 'none' | 'oauth2' | 'smart'
```

Production env vars come from your secrets manager (Vault / cloud KMS).

## Run migrations

```bash
# From repo root
pnpm --filter @app/core run migrate:dev
```

This creates the `app`, `hospital`, and `audit` schemas and seeds dev tenant + dev admin user.

## Run the stack

In separate terminals (or use `just dev` to start all):

```bash
# Terminal 1 — core API
pnpm --filter @app/core run dev

# Terminal 2 — narrative service
cd apps/narrative && uv run uvicorn main:app --port 5001 --reload

# Terminal 3 — Q&A service
cd apps/qa && uv run uvicorn main:app --port 5002 --reload

# Terminal 4 — web
pnpm --filter @app/web run dev
```

Open:
- Web: http://localhost:3000
- API docs (Swagger): http://localhost:4000/api/docs
- Keycloak admin: http://localhost:8080 (admin/admin)
- MinIO console: http://localhost:9001 (minioadmin/minioadmin)
- Jaeger: http://localhost:16686

## Stub mode

The repo ships with two stub modes so a new developer can run the whole stack without external credentials:

- `FOUNDATION_MODEL_PROVIDER=stub` — returns canned narrative / Q&A answers
- `EMBEDDING_MODEL_PROVIDER=stub` — returns deterministic fake embeddings

This lets you run UI work, integration tests, and most of the API surface without a model contract in place.

## Seed data

```bash
pnpm --filter @app/core run seed:dev
```

Seeds:
- 1 tenant
- 5 dev users with assorted roles
- 50 synthetic patients with encounters, observations, conditions, medications
- 200 sample Q&A questions (labeled allowed/refused) for classifier eval

All synthetic data — never includes real PHI.

## Smoke test

```bash
just smoke
```

Runs: API health checks, OIDC login flow, FHIR fetch from HAPI sandbox, end-to-end Q&A with stubs, audit log integrity verification.

Pass = green. Failure means the dev environment is broken; fix before continuing.

## Creating the repo from this spec bundle

If you're starting from scratch (this spec bundle dropped into an empty repo):

1. Create the directory structure shown in `CLAUDE.md` section 4
2. Initialize git, add a `.gitignore` (Node + Python + JetBrains + VSCode + .DS_Store + .env)
3. Add `LICENSE` (decide: proprietary or open core)
4. Add `README.md` (one paragraph + link to `CLAUDE.md`)
5. Open Claude Code in the repo. Your first prompt:
   > "Read CLAUDE.md and the docs/ directory. Then implement Slice 0 per docs/build/03-slices.md. Stop after the exit gate is met and summarize what you built."
