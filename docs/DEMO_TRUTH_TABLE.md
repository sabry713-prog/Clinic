# Demo Truth Table — What Is Live, Scripted, Simulated, or Unavailable

**Version:** v1.0 · **Date:** 15 September 2026
**Branch:** `feat/ui-light-theme`
**Purpose:** H06 (readiness assessment) — one authoritative reference so the
demo runbook, the deck, and the app never tell contradictory stories.

## Quick reference

| ✅ LIVE (real engine, real data flow) | 📝 SCRIPTED (deterministic playback) | 🔌 SIMULATED (stub connector) | ⚠️ UNAVAILABLE (not built) |
|---|---|---|---|
| Q&A classification | Demo transcript playback | NPHIES payer responses | Speaker diarization |
| Q&A retrieval (PostgreSQL) | SOAP canned stages (demo mode) | HIS order transmission | Live NPHIES submission |
| Q&A synthesis (DeepSeek) | | SMS/OTP delivery | Real patient data |
| Blocklist gate | | MinIO WORM export target | Hospital FHIR feed |
| NSCRE graph reasoning | | | Arabic ASR validation |
| Evidence-chain cutaway | | | Clinical evaluation dataset |
| Audit hash chain + verify | | | |
| Claim simulator (local checks) | | | |
| Coder queue (durable) | | | |
| Journey wizard (5 stages) | | | |
| Ambient dictation (live mic) | | | |
| SOAP generation (live) | | | |
| Smart checklist (LLM + keyword) | | | |
| Speaker toggle (manual) | | | |
| Patient file (all panels) | | | |
| RBAC + patient scope | | | |
| Session revocation (M02) | | | |

## Detail by surface

### Authentication & access
| Feature | Status | Notes |
|---|---|---|
| Keycloak OIDC login | ✅ LIVE | Realm `dev`, 4 seeded users |
| RBAC (role → permission) | ✅ LIVE | Enforced by RbacGuard on every route |
| Patient scope enforcement | ✅ LIVE | Out-of-scope returns 403 |
| Session revocation (M02) | ✅ LIVE | DB check on every request |
| Dev-session endpoint | ⚠️ GATED | Requires `DEV_SESSION_ENABLED=true` (C07) |

### Clinical documentation
| Feature | Status | Notes |
|---|---|---|
| Live dictation (microphone) | ✅ LIVE | faster-whisper large-v3, English |
| Demo transcript playback | 📝 SCRIPTED | Pre-scripted 7-line consultation, labeled "not a recording" |
| SOAP auto-generation | ✅ LIVE | DeepSeek formatting, live mode, ≥3 lines |
| SOAP canned stages | 📝 SCRIPTED | Demo mode only, progressively revealed |
| Speaker toggle | ✅ LIVE | Manual Doctor/Patient toggle; no auto-diarization |
| Smart checklist | ✅ LIVE | Dual-layer: keyword matcher + LLM extraction (quote-verified) |
| Draft save/sign | ✅ LIVE | Persistent, auditable |

### AI agents
| Feature | Status | Notes |
|---|---|---|
| Scribe "Regenerate SOAP" | ✅ LIVE | Orchestrator → DeepSeek |
| Consultant "Summarise priors" | ✅ LIVE* | *Disabled in demo containment (C04) |
| Consultant evidence chain | ✅ LIVE | Verbatim from NSCRE |
| Pharmacist DDI/dose findings | ✅ LIVE | From NSCRE graph |
| Pharmacist dose prose | ⚠️ CONTAINED | Disabled in demo (C04) |
| NPHIES agent (necessity) | ✅ LIVE | From graph necessity rules |
| Receptionist (booking) | ✅ LIVE | Core booking workflow |
| Receptionist (SMS/OTP) | 🔸 STUB | Code logged to server, no SMS sent |

### Claims & billing
| Feature | Status | Notes |
|---|---|---|
| Claim readiness checks | ✅ LIVE | Postgres queries, deterministic |
| ICD/SBS code suggestions | ✅ LIVE | Reference-map lookup |
| Diagnosis linkage | ✅ LIVE | Clinician-chosen, verdict dots inform |
| Claim simulator (local) | ✅ LIVE | Deterministic checks + graph necessity |
| Coder queue | ✅ LIVE | Durable (M09), restart-safe |
| Pre-auth submission | 🔸 SIMULATED | Stub payer returns "pended", never "approved" |
| NPHIES claim submission | 🔸 SIMULATED | Stub returns "accepted" for demo; NOT real payer |
| NPHIES eligibility | 🔸 SIMULATED | Stub returns "eligible" |
| HIS order transmission | 🔸 SIMULATED | Stub returns "accepted by Hospital System" |

### Data & evidence
| Feature | Status | Notes |
|---|---|---|
| Evidence-chain cutaway | ✅ LIVE | Verbatim Cypher from the engine |
| Audit hash chain | ✅ LIVE | SHA-256, verify endpoint |
| Audit WORM export | ✅ LIVE* | *To MinIO dev; production S3 target needs config |
| Reference-data governance | ✅ LIVE | Checksummed manifest, verification gate (M11) |
| Graph lineage | ✅ LIVE | release_version + ingested_at on nodes (M06) |
| Patient data | 📝 SYNTHETIC | All patients are synthetic seed data |

### Infrastructure
| Feature | Status | Notes |
|---|---|---|
| Postgres / Neo4j / Keycloak / MinIO | ✅ LIVE | Docker, loopback-only (C07) |
| All Python AI services | ✅ LIVE | 6 services on :5001–:5006 |
| Health checks (enriched) | ✅ LIVE | /health + /health/ready + /health/preflight (H02) |
| pg connection resilience | ✅ LIVE | Pool error listener prevents crash |

## Connector modes (surfaced on /health/ready)

| Connector | Mode | What it means |
|---|---|---|
| NPHIES | `stub` | No real payer; all responses simulated |
| HIS | `stub` | No real hospital system; "accepted" is simulated |
| SMS/OTP | `stub` | No provider; codes logged to server console |
| Model provider | `deepseek` | Real DeepSeek API (cloud) |
| Transcription | `local` | faster-whisper large-v3 (on-prem) |

## Expected clicks (Journey wizard headline path)

1. Stage 1: Record (or play demo) → SOAP fills → **Save note to record**
2. Stage 2: Diagnoses on file (usually nothing to add)
3. Stage 3: Orders (suggested from SOAP, pre-checked) → **Create selected**
4. Stage 4: SBS codes (pre-checked) → **Approve codes** · Link diagnoses (tap chips)
5. Stage 5: Eligibility (auto) → **Submit claim** → "accepted (stub)"

Total: ~7 explicit approvals. All clinical actions require the clinician's click.
