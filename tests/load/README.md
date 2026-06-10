# Load Tests (k6)

Performance tests for every NFR latency budget defined in the spec.

## Prerequisites

```bash
brew install k6   # macOS
# or: https://k6.io/docs/getting-started/installation/
```

## Running

```bash
# Single test against local dev stack
BASE_URL=http://localhost:4000 \
LOAD_TEST_USER=loadtest@hospital.local \
LOAD_TEST_PASSWORD=changeme \
k6 run tests/load/patient-view.js

# Via justfile
just test-load patient-view
just test-load-all
```

## Tests and budgets

| Script | VUs | Duration | P95 budget |
|---|---|---|---|
| `patient-view.js` | 50 | ramp 1m + sustain 5m | ≤ 2 000 ms |
| `qa-allowed.js` | 30 | ramp 1m + sustain 5m | ≤ 7 000 ms |
| `qa-refused.js` | 30 | ramp 30s + sustain 5m | ≤ 1 000 ms |
| `narrative.js` | 20 | ramp 1m + sustain 5m | ≤ 8 000 ms |
| `ward-handoff.js` | 5 | ramp 30s + sustain 10m | ≤ 60 000 ms |

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `BASE_URL` | Base URL of the core service | `http://localhost:4000` |
| `LOAD_TEST_USER` | Username for load test account | `loadtest@hospital.local` |
| `LOAD_TEST_PASSWORD` | Password for load test account | `loadtest-password` |

## PHI safety

All patient IDs and ward IDs used in these tests are synthetic identifiers
(`synthetic-patient-NNNN`, `synthetic-ward-NNNN`). No real patient data is
used. Questions are pre-approved factual or known-refused phrases with no
patient-specific content.

## Interpreting results

A test passes only if ALL thresholds pass. k6 exits with code 99 on threshold
failure. The CI pipeline treats any non-zero exit from k6 as a build failure.
