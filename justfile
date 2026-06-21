#!/usr/bin/env just --justfile

# Start all infrastructure
infra-up:
    docker compose -f docker-compose.dev.yml up -d

# Stop all infrastructure
infra-down:
    docker compose -f docker-compose.dev.yml down

# Reset infrastructure (wipes data)
infra-reset:
    docker compose -f docker-compose.dev.yml down -v

# Run database migrations
migrate:
    pnpm --filter @app/core run migrate:dev

# Seed dev data
seed:
    pnpm --filter @app/core run seed:dev

# Seed the FULL demo dataset (dev + enrich + symptoms + reconciliation + search index)
seed-demo:
    pnpm --filter @app/core run seed:all

# One-command clean bring-up for a demo: infra + migrate + full seed.
# After this completes, run `just dev` and open http://localhost:3000.
demo-setup:
    #!/usr/bin/env bash
    set -e
    just infra-up
    echo "Waiting for Postgres + Keycloak…"
    until docker exec cc-postgres pg_isready -U app -d clinical_copilot >/dev/null 2>&1; do sleep 2; done
    until curl -sf http://localhost:8080/realms/dev/.well-known/openid-configuration >/dev/null 2>&1; do sleep 2; done
    just migrate
    just seed-demo
    echo "Demo data ready. Start services with: just dev"

# Start all services in dev mode
dev:
    #!/usr/bin/env bash
    set -e
    trap 'kill 0' EXIT
    pnpm --filter @app/core run dev &
    pnpm --filter @app/web run dev &
    cd apps/narrative && uv run uvicorn main:app --port 5001 --reload &
    cd apps/qa && uv run uvicorn main:app --port 5002 --reload &
    wait

# Run all tests
test:
    pnpm run test
    cd apps/narrative && uv run pytest
    cd apps/qa && uv run pytest

# Lint everything
lint:
    pnpm run lint
    cd apps/narrative && uv run ruff check .
    cd apps/qa && uv run ruff check .

# Type check everything
typecheck:
    pnpm run typecheck
    cd apps/narrative && uv run mypy .
    cd apps/qa && uv run mypy .

# Build all
build:
    pnpm run build

# Install all dependencies
install:
    pnpm install
    cd apps/narrative && uv sync
    cd apps/qa && uv sync
    cd packages/classifier && uv sync
    cd packages/retrieval && uv sync
    cd packages/blocklist && uv sync

# ─── Security ────────────────────────────────────────────────────────────────

# Run all security checks locally
test-security: npm-audit pip-audit semgrep

npm-audit:
    pnpm audit --audit-level=high

pip-audit:
    #!/usr/bin/env bash
    set -e
    for dir in apps/narrative apps/qa packages/classifier packages/blocklist packages/retrieval; do
      echo "=== pip-audit: $dir ==="
      (cd "$dir" && uv run pip-audit --require-hashes=0 --strict)
    done

semgrep:
    semgrep --config=auto --severity=ERROR --error .

# ─── Load tests ──────────────────────────────────────────────────────────────

# Run a single load test (default: patient-view)
test-load service="patient-view":
    k6 run tests/load/{{service}}.js

# Run all load tests sequentially
test-load-all:
    just test-load patient-view
    just test-load qa-refused
    just test-load qa-allowed
    just test-load narrative
    just test-load ward-handoff

# ─── Classifier evaluation ───────────────────────────────────────────────────

# Evaluate classifier against holdout corpus
eval-classifier lang="en":
    cd packages/classifier && uv run python -m classifier.eval --corpus holdout --lang {{lang}}

# Evaluate classifier against stress corpus
eval-classifier-stress:
    cd packages/classifier && uv run python -m classifier.eval --corpus stress --lang en

# ─── Database backup ─────────────────────────────────────────────────────────

# Run a manual database backup
backup-db:
    ./infra/scripts/backup-db.sh

# ─── Helm ────────────────────────────────────────────────────────────────────

# Preview Helm diff against a live environment
helm-diff env="dev":
    helm diff upgrade clinical-copilot infra/helm -f infra/helm/values-{{env}}.yaml

# Deploy / upgrade Helm release
helm-deploy env="dev":
    helm upgrade --install clinical-copilot infra/helm \
        -f infra/helm/values-{{env}}.yaml \
        --namespace clinical-copilot-{{env}} \
        --create-namespace

# ─── WORM audit export ───────────────────────────────────────────────────────

# Manually trigger yesterday's WORM audit export
audit-worm-export:
    curl -X POST http://localhost:4000/api/v1/admin/audit/export-worm \
      -H "Authorization: Bearer $ADMIN_TOKEN"

# ─── Smoke test (updated) ─────────────────────────────────────────────────────

# Full smoke test including metrics endpoints
smoke:
    #!/usr/bin/env bash
    set -e
    echo "Checking core health..."
    curl -sf http://localhost:4000/api/v1/health | jq .
    echo "Checking narrative health..."
    curl -sf http://localhost:5001/health | jq .
    echo "Checking qa health..."
    curl -sf http://localhost:5002/health | jq .
    echo "Checking core metrics..."
    curl -sf http://localhost:4000/metrics | grep "http_requests_total" | head -3
    echo "All services healthy!"
