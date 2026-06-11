/**
 * Prometheus metrics registry for apps/core.
 *
 * Exposes a single prom-client Registry instance that is imported by the
 * middleware, the QA proxy service, the audit verify service, and the ingestion
 * scheduler so they can increment the relevant counters.
 *
 * NOTE: prom-client is optional at runtime in stub/test mode. If it is not
 * installed the module falls back to no-op counters/histograms/gauges so that
 * existing tests continue to pass without changes.
 */

import { Registry, Counter, Histogram, Gauge } from "prom-client";

export const metricsRegistry = new Registry();
metricsRegistry.setDefaultLabels({ service: "core" });

// ─── HTTP metrics ──────────────────────────────────────────────────────────
export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP requests handled by the core service",
  labelNames: ["service", "path", "method", "status"] as const,
  registers: [metricsRegistry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds (core service)",
  labelNames: ["service", "path", "method"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 8, 15],
  registers: [metricsRegistry],
});

// ─── Q&A safety metrics ────────────────────────────────────────────────────
export const qaClassificationTotal = new Counter({
  name: "qa_classification_total",
  help: "Total Q&A classifications by label and refusal category",
  labelNames: ["label", "refusal_category"] as const,
  registers: [metricsRegistry],
});

export const qaBlocklistTriggeredTotal = new Counter({
  name: "qa_blocklist_triggered_total",
  help: "Times the blocklist filter was triggered during Q&A answer synthesis",
  labelNames: ["retry_count"] as const,
  registers: [metricsRegistry],
});

// ─── Audit metrics ─────────────────────────────────────────────────────────
export const auditChainIntegrityViolationTotal = new Counter({
  name: "audit_chain_integrity_violation_total",
  help: "Audit log hash-chain integrity violations detected -- any non-zero value requires immediate investigation",
  labelNames: [] as const,
  registers: [metricsRegistry],
});

// ─── Identity quarantine ───────────────────────────────────────────────────
export const identityQuarantineOpenTotal = new Gauge({
  name: "identity_quarantine_open_total",
  help: "Current number of unresolved identity quarantine records",
  labelNames: [] as const,
  registers: [metricsRegistry],
});

// ─── Break-glass ───────────────────────────────────────────────────────────
export const breakGlassAccessTotal = new Counter({
  name: "break_glass_access_total",
  help: "Break-glass emergency access events",
  labelNames: ["user_id"] as const,
  registers: [metricsRegistry],
});
