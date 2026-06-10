FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/audit/package.json ./packages/audit/
COPY apps/core/package.json ./apps/core/
RUN pnpm install --frozen-lockfile

# Build
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared-types ./packages/shared-types/
COPY packages/audit ./packages/audit/
COPY apps/core ./apps/core/
RUN pnpm --filter @clinical-copilot/shared-types run build
RUN pnpm --filter @clinical-copilot/audit run build
RUN pnpm --filter @app/core run build

# Runtime
FROM node:20-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate
WORKDIR /app

COPY --from=build /app/apps/core/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build /app/packages/audit/dist ./packages/audit/dist

EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget --spider -q http://localhost:4000/api/v1/health || exit 1

CMD ["node", "dist/main"]
