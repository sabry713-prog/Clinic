# 04 — Testing Strategy

## Test pyramid (target coverage)

| Layer | Coverage target | Tooling |
|---|---|---|
| Unit | ≥80% on core business logic, classifier, blocklist, retrieval | Vitest (TS), pytest (Python) |
| Integration | Every cross-service path + every external integration | Vitest + Testcontainers, pytest + Testcontainers |
| Contract | gRPC & FHIR contracts | Buf for gRPC, FHIR resource validators |
| E2E | Critical user journeys per slice exit gate | Playwright |
| Clinical safety | Blocklist + classifier corpora; panel-reviewed Q&A samples | Custom harness, manual review |
| Performance | Each API hits its NFR budget under load | k6 |
| Security | SAST + dependency scan on every PR; DAST weekly | Semgrep, npm audit, pip-audit, Trivy, OWASP ZAP |

## Test data

Everything tested with **synthetic data only**. No real PHI in any test environment.

Sources:
- Synthea-generated FHIR bundles (English)
- Hand-crafted Arabic clinical scenarios
- HAPI FHIR public sandbox for integration tests against a live FHIR endpoint

Store seed data in `tests/fixtures/` (git-tracked, sized via Git LFS if needed).

## Unit tests

Conventions:
- One test file per source file (`foo.ts` → `foo.test.ts`)
- Arrange-Act-Assert structure
- No mocks of internal modules in unit tests; mock external boundaries only (database, model client, HTTP)
- Each test name is a sentence: `it("returns REFUSED when the question contains 'getting worse'", ...)`
- Fast: a full unit test run under 60 seconds

Special unit suites:
- **Classifier rules**: every rule's positive and negative examples are unit tests.
- **Blocklist patterns**: `should_block.txt` and `should_allow.txt` corpora are run as parameterized tests.
- **FHIR mapping**: every mapping in `docs/data/02-fhir-mapping.md` has a fixture and an expected result.

## Integration tests

Use Testcontainers to spin up real PostgreSQL + Keycloak + MinIO. Skip pulling foundation model — use stub provider.

Cover:
- Auth: full OIDC code flow against Keycloak
- Database: migrations apply cleanly to an empty DB; RLS policies enforce scope
- FHIR ingestion: pull a fixture bundle from a mock FHIR server, verify rows in `hospital.*`
- Identity reconciliation: each match scenario (auto-merge, quarantine, separate)
- Audit hash chain: insert events, verify integrity, attempt tamper, verify violation detected
- Q&A flow with stubs: classify → retrieve → synthesize → respond
- Refusal flow: known refusal categories return correct templates with offered facts

## Contract tests

- gRPC: Buf check on every PR; breaking changes require explicit version bump
- FHIR: validate ingested resources against R4 schemas; warn on NPHIES profile non-conformance
- API: OpenAPI schema generated from NestJS controllers; schema diff visible in PR

## E2E tests (Playwright)

One per slice exit gate, plus regression tests for fixed bugs.

Examples:
- "Physician logs in, opens patient on care team, sees aggregated view in <2s"
- "Physician attempts patient out of scope → 403 with no PHI leakage"
- "Physician generates narrative → sees provenance hover sources"
- "Physician asks 'what's the last creatinine?' → factual answer with source"
- "Physician asks 'is kidney function getting worse?' → refusal with values listed"
- "Physician asks in Arabic → answer in Arabic with correct RTL layout"
- "Hospital admin searches audit log for QA_REFUSED events → results"

E2E tests run against the full Docker Compose stack. They are slower (a few minutes) and run on PR merge + nightly.

## Clinical safety tests

These are not pass/fail in CI — they are **panel-reviewed**.

**Blocklist test corpus** (CI gate):
- `should_block.txt`: 100% must trigger the blocklist
- `should_allow.txt`: 0% must trigger the blocklist
- Both corpora grow over time; clinical advisor signs off on additions

**Classifier evaluation** (CI gate):
- Holdout evaluation per `docs/classifier/03-evaluation.md` must meet thresholds (sensitivity ≥0.98 on REFUSED, etc.)

**Q&A panel review** (manual, per slice):
- 100 sample Q&A interactions reviewed by clinical advisor
- Rubric: factual accuracy, refusal correctness, presence of interpretive language, source attribution accuracy
- Findings logged in `quality/reviews/{date}.md`

**Narrative panel review** (manual, per slice):
- 30 sample narratives reviewed similarly

## Performance tests (k6)

Scenarios:
- Patient view: 50 concurrent users, ramp 0→50 over 1 min, sustain 5 min → P95 ≤2s
- Q&A allowed: 30 concurrent users → P95 ≤7s
- Q&A refused: 30 concurrent users → P95 ≤1s
- Narrative generation: 20 concurrent → P95 ≤8s
- Ward handoff (20 patients): 5 concurrent → P95 ≤60s

Run weekly against staging. Block merge if a PR worsens a budget.

## Security tests

**Every PR:**
- Semgrep (SAST) against changed files
- `pnpm audit` and `pip-audit` against dependencies
- Trivy scan against built container images

**Weekly:**
- OWASP ZAP baseline scan against staging
- `npm audit` and `pip-audit` on full lockfiles

**Quarterly:**
- Third-party penetration test
- Internal red-team exercise (e.g., attempt classifier evasion with edge phrasings)

## Test commands

```bash
# Run everything
just test

# Unit tests only
pnpm test           # TS
uv run pytest       # Python

# Integration
just test-integration

# E2E
just test-e2e

# Performance
just test-perf

# Security
just test-security
```

## CI policy

Required to merge:
- All unit + integration tests green
- Type check green
- Lint green
- Security scans green (no high / critical)
- Coverage doesn't regress
- Contract checks green
- For PRs touching `/docs/prompts/`, `/docs/classifier/`, or `/packages/blocklist/`: explicit CTO + Clinical Advisor approval

Optional but encouraged:
- E2E pass on the PR's branch
- Performance smoke pass
