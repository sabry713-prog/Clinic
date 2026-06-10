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

# Smoke test
smoke:
    #!/usr/bin/env bash
    set -e
    echo "Checking core health..."
    curl -sf http://localhost:4000/api/v1/health | jq .
    echo "Checking narrative health..."
    curl -sf http://localhost:5001/health | jq .
    echo "Checking qa health..."
    curl -sf http://localhost:5002/health | jq .
    echo "All services healthy!"

# Install all dependencies
install:
    pnpm install
    cd apps/narrative && uv sync
    cd apps/qa && uv sync
    cd packages/classifier && uv sync
    cd packages/retrieval && uv sync
    cd packages/blocklist && uv sync
