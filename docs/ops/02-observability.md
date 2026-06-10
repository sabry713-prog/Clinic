# 02 — Observability

## Three pillars

| Pillar | Tool | What it answers |
|---|---|---|
| Logs | Loki (or hospital-preferred SIEM) | "What happened?" |
| Metrics | Prometheus + Grafana | "How is the system performing?" |
| Traces | Jaeger / Tempo | "Where is the slow / failing request?" |

All instrumentation is via OpenTelemetry. No vendor lock-in to a specific observability backend.

## Logging discipline

### Format

Structured JSON. Required fields on every log line:

```json
{
  "ts": "2026-05-25T08:04:00.123Z",
  "level": "info" | "warn" | "error" | "debug",
  "service": "core" | "narrative" | "qa" | "web",
  "request_id": "req_...",
  "trace_id": "trace_...",
  "user_id": "uuid",                // when authenticated
  "tenant_id": "uuid",
  "event": "qa.refused",            // dotted event name
  ...event-specific fields...
}
```

### PHI rules

- **Never** log free-text Q&A questions, narrative outputs, or patient field values to operational logs.
- Use IDs (`patient_id`, `observation_id`) and codes (`refusal_category`, `classifier_label`) instead.
- Question text and generated content live in the **audit log**, not operational logs.
- The audit log has stricter access controls and longer retention.

### Levels

- `error`: condition requires human attention (e.g., upstream system failure, persistent retry exhaustion)
- `warn`: degraded behavior worth noticing (e.g., classifier low confidence, blocklist retry triggered)
- `info`: significant events worth recording (e.g., user login, ingestion job completed)
- `debug`: development-time only; disabled in staging and prod by default

### Sensitive log routing

Audit-grade logs go to the `audit.event` table and a separate WORM bucket. Application logs go to the regular log sink. They are not mixed.

## Metrics

### Service-level objectives (SLOs)

| Service | SLO | Window |
|---|---|---|
| `core` | 99.5% requests under 1 s | 30 days rolling |
| Patient view endpoint | 95% of requests under 2 s | 30 days |
| Q&A allowed | 95% of requests under 7 s | 30 days |
| Q&A refused | 95% of requests under 1 s | 30 days |
| Narrative | 95% of requests under 8 s | 30 days |
| Availability (overall) | 99.5% | per month |

Track via Prometheus histograms; visualize via Grafana SLO dashboard.

### Standard metrics per service

- `http_requests_total{service, path, method, status}`
- `http_request_duration_seconds{service, path, method, le}` (histogram)
- `grpc_requests_total{service, method, code}`
- `grpc_request_duration_seconds{service, method, le}`
- `db_query_duration_seconds{service, query_name, le}`
- `external_call_duration_seconds{service, target, le}`
- `error_rate{service, type}`

### Clinical-safety metrics

These are not just operational — they are **regulatory evidence**.

- `qa_classification_total{label, refusal_category, classifier_confidence_bucket}`
- `qa_blocklist_triggered_total{service, retry_count}`
- `qa_fallback_total{service, reason}`
- `narrative_blocklist_triggered_total{retry_count}`
- `narrative_fallback_total{reason}`
- `classifier_low_confidence_total` (confidence in [0.5, 0.85])
- `audit_chain_integrity_violation_total` (alerts on any non-zero)
- `identity_quarantine_open_total` (gauge; should drain over time)
- `break_glass_access_total` (alerting threshold: any unusual spike)

### Dashboards

Standard dashboards:
- **Overview**: traffic, errors, latency, availability
- **Q&A**: classification distribution, refusal categories, blocklist triggers, classifier confidence histogram
- **Narrative**: generation latency, blocklist triggers, fallback rate
- **Data ingestion**: FHIR sync success / failure, identity quarantine queue depth
- **Security**: auth success / failure, lockouts, break-glass events
- **Performance**: per-endpoint latency P50 / P95 / P99
- **Resources**: CPU, memory, database connections, queue depths

### Alerts

| Alert | Condition | Severity | Recipient |
|---|---|---|---|
| Service down | health check fails 3x | critical | on-call engineer + hospital IT |
| High error rate | error rate > 1% over 5 min | high | on-call engineer |
| Q&A blocklist surge | blocklist triggers > 5/min | high | on-call + clinical advisor |
| Classifier confidence drop | mean confidence drops > 10% week-over-week | medium | tech lead |
| Audit chain integrity violation | any non-zero count | **critical** | CTO + on-call + security |
| Identity quarantine queue building | depth > 50 unresolved | medium | hospital admin + tech lead |
| Break-glass spike | > 5/hour | medium | hospital admin + DPO |
| FHIR ingestion stalled | no successful sync in 1 hour | high | on-call |
| External model unreachable | > 1 minute | high | on-call |

Use Alertmanager for routing.

## Tracing

Every external request gets a trace ID propagated through:
- Web → core
- Core → narrative (gRPC)
- Core → qa (gRPC)
- Core → PostgreSQL
- Narrative/qa → model client
- Narrative/qa → retrieval

Useful spans:
- `qa.classify`
- `qa.retrieve.vector`
- `qa.retrieve.keyword`
- `qa.synthesize.model_call`
- `qa.filter.blocklist`
- `qa.refusal.build`
- `narrative.assemble`
- `narrative.model_call`
- `narrative.filter.blocklist`
- `audit.write`

Sample rate:
- Dev / staging: 100% sampling
- Prod: head-based sampling at 10% + tail sampling that always keeps errors and slow requests

## On-call

See `docs/ops/03-incident-response.md`.

## Audit visibility

The audit log is queryable through:
- The admin API (for hospital admins) — filtered, scoped queries
- Direct database access (for sysadmin under break-glass) — full table
- The WORM replica (for forensics) — read-only NDJSON files in object storage

Routine dashboards include:
- Audit events per hour by action type
- Top users by audit event count
- Refusal category distribution
- Daily integrity verification status
