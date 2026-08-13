#!/usr/bin/env just --justfile

# Load .env into every recipe's environment. apps/core (dotenv.config()) and
# apps/narrative/apps/qa (pydantic-settings' env_file=) already load it
# themselves, so this is a no-op there -- but services/orchestrator,
# services/veritas-graph, and services/nphies-engine read os.environ
# directly with no loader of their own (deepseek_client.py's DEEPSEEK_API_KEY
# check included), so without this they'd never see DATABASE_URL,
# DEEPSEEK_API_KEY, NSCRE_API_URL, NPHIES_CONNECTOR, or SIM_* -- silently
# falling back to defaults regardless of what .env actually says.
set dotenv-load := true

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

# Fixes the L-1 stale-process trap: rerunning `just dev` after a crash used
# to fail with EADDRINUSE instead of just reclaiming the port. Scoped
# strictly by port, never by process name, so it can't take out an
# unrelated node/python process on the machine.
# Kill whatever is bound to a port this stack uses, then nothing else.
restart-services:
    #!/usr/bin/env bash
    set -e
    for port in 3000 4000 5001 5002 5003 5004 5005 5006; do
      pid=$(netstat -ano 2>/dev/null | awk -v port="$port" '
        $1 == "TCP" && $4 == "LISTENING" {
          n = split($2, addr, ":");
          if (addr[n] == port) print $NF;
        }' | sort -u | head -1)
      if [ -n "$pid" ] && [ "$pid" != "0" ]; then
        echo "Killing stale process on port $port (PID $pid)"
        # powershell.exe sets its own process exit code to non-zero whenever
        # ANY error record was raised during the session -- even one fully
        # caught by try/catch inside the script. If the process already
        # exited between the netstat snapshot above and this call, that
        # non-zero exit combined with `set -e` would otherwise abort this
        # whole recipe on what is just a harmless race, so it's silenced
        # here on the bash side instead of relying on PowerShell's exit code.
        powershell.exe -NoProfile -Command "Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue" || true
      fi
    done
    echo "Stale service ports cleared."

# The graph/orchestrator/nphies-engine services were missing here entirely,
# so ORCHESTRATOR_MODEL_PROVIDER=stub's scripted_model.py fallback and the
# AI Team drawer had nothing to talk to.
# Start all services in dev mode (core/web/narrative/qa/transcription/veritas-graph/orchestrator/nphies-engine)
dev:
    #!/usr/bin/env bash
    set -e
    trap 'kill 0' EXIT
    pnpm --filter @app/core run dev &
    pnpm --filter @app/web run dev &
    cd apps/narrative && uv run uvicorn main:app --port 5001 --reload &
    cd apps/qa && uv run uvicorn main:app --port 5002 --reload &
    cd apps/transcription && uv run uvicorn main:app --port 5003 --reload &
    cd services/veritas-graph && uv run python api_router.py &
    cd services/orchestrator && uv run python agent_handlers.py &
    cd services/nphies-engine && uv run python api_router.py &
    wait

# The task this was written against asked for a literal
# infra-reset -> migrate -> seed -> demo-setup -> dev chain, which has a real
# bug and a real redundancy: infra-reset (`docker compose down -v`) leaves
# Postgres DOWN, so a bare `migrate` right after it has nothing to connect
# to -- demo-setup already does infra-up + a readiness wait + migrate +
# seed-demo (the full seed:all, including nphies-claims) in that order, so a
# standalone migrate/seed beforehand would just be a slower duplicate of
# what demo-setup does anyway. This calls demo-setup exactly once, right
# after the reset, instead of reproducing that bug.
# One-command clean demo: wipe -> bring up -> migrate -> full seed -> clear stale ports -> start every service.
demo: infra-reset demo-setup restart-services
    just dev

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
    cd apps/transcription && uv sync
    cd services/veritas-graph && uv sync
    cd services/orchestrator && uv sync
    cd services/nphies-engine && uv sync
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
    echo "Checking veritas-graph health..."
    curl -sf http://localhost:5004/health | jq .
    echo "Checking orchestrator health..."
    curl -sf http://localhost:5005/health | jq .
    echo "Checking nphies-engine health..."
    curl -sf http://localhost:5006/health | jq .
    echo "Checking core metrics..."
    curl -sf http://localhost:4000/api/v1/metrics | grep "http_requests_total" | head -3
    echo "All services healthy!"
