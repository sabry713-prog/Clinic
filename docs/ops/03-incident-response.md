# 03 — Incident Response

## Severity definitions

| Severity | Definition | Examples |
|---|---|---|
| **SEV-1 / Critical** | Patient-safety risk, or clinical interpretation reached a user, or active data breach | Q&A returned an interpretive answer to a clinician; audit log integrity violation; PHI exfiltration suspected |
| **SEV-2 / High** | Major function unavailable for a significant user population, no patient-safety risk | Q&A service down; ingestion stalled > 4h; authentication broken |
| **SEV-3 / Medium** | Degraded function or single-user issue | Latency budget breached; intermittent retrieval failures; one user cannot log in |
| **SEV-4 / Low** | Cosmetic, planned-known issue, or workaroundable | UI text error; non-critical metric missing |

## On-call rotation

- Engineering on-call: 24/7 during pilot; primary + secondary
- Clinical advisor: business-hours pager during pilot; on-call for SEV-1 only
- Regulatory consultant: notified for SEV-1 involving classification or interpretation
- Hospital IT lead: notified for SEV-1/2 affecting the hospital

## Response targets

| Severity | Acknowledge | Initial response | Resolve target |
|---|---|---|---|
| SEV-1 | 5 min | 15 min | 4 hours |
| SEV-2 | 15 min | 30 min | 8 hours |
| SEV-3 | 1 hour (business) | 4 hours | 3 business days |
| SEV-4 | next business day | best effort | next sprint |

## SEV-1 protocol: interpretive output reached a clinician

This is the most consequential failure mode for this product. Specific playbook:

1. **Stop the bleed.** Set the feature flag `qa.allow_responses=false` to put Q&A into refusal-only mode. Narrative similarly: `narrative.enabled=false` if the issue is in narrative.
2. **Page the CTO and clinical advisor.** SMS + phone.
3. **Capture evidence.** Pull the `qa_interaction` row (or `narrative_output` row) and all related audit events. Preserve the model version, prompt template version, classifier version, blocklist version. Take a snapshot of the entire DB transaction (audit_event range + interaction record).
4. **Notify the hospital admin and DPO** in writing within 1 hour.
5. **Notify the regulatory consultant** within 4 hours.
6. **Triage the clinical impact.** Did the answer influence a clinical decision? Reach the patient's actual care team to confirm.
7. **Root cause.** Was it a classifier miss? A blocklist gap? A prompt drift? An out-of-band model behavior change?
8. **Patch.** Add a rule to the classifier and/or pattern to the blocklist. Land tests for the specific failure case. Verify against full evaluation corpus.
9. **Re-enable Q&A** only after CTO + Clinical Advisor sign-off.
10. **Post-mortem** within 5 business days. Findings documented; control-register entry updated.

The "stop the bleed" feature flag is the most important control: it must be testable on its own and be the first thing every on-call engineer knows how to use.

## SEV-1 protocol: audit log integrity violation

1. **Freeze writes** to the affected table (read-only mode) immediately.
2. **Page CTO + security lead.**
3. **Preserve the chain state.** Take an immutable snapshot of `audit.event` rows in the range around the violation.
4. **Investigate**: hash mismatch? Out-of-order timestamps? Manual DB tampering?
5. **Cross-check** with the WORM replica. If the WORM replica is consistent and the live table is not, the live table was tampered with — initiate hospital security incident process.
6. **Restore** the live table from the WORM replica if needed.
7. **Resume writes** only after integrity is re-established and the root cause is closed.

## SEV-1 protocol: suspected PHI exfiltration

1. **Cut network egress** to any non-allowlisted external endpoint immediately.
2. **Page CTO + DPO + hospital DPO + security lead.**
3. **Identify scope**: which patients, what data, when, by whom.
4. **Engage hospital incident response process** — this is now a hospital-led incident with us as the technology party.
5. **PDPL breach notification** decision: notify SDAIA within 72 hours per Article 20 if criteria met.
6. **Patient notification** decision: per hospital policy and PDPL guidance.
7. **Post-mortem** with hospital DPO; jointly authored report; control changes implemented.

## SEV-2 playbooks

### Q&A service down

1. Verify (curl health endpoint, check Kubernetes pod status)
2. If pod crash-looping: capture logs, check resource pressure, check recent deploy → rollback if recent change
3. Frontend automatically degrades (Q&A panel hidden); patient view + narrative continue working
4. Communicate to hospital IT
5. Restore + verify with smoke test

### Ingestion stalled

1. Check FHIR endpoint reachability (curl from inside cluster)
2. Check ingestion job logs for error patterns
3. Check FHIR endpoint rate limits (we may be throttled)
4. If hospital endpoint is the issue: notify hospital IT and pause our retry
5. Resume after upstream is healthy

### Auth broken

1. Check OIDC issuer reachability
2. Check token validation: try a known-good token
3. Check Keycloak realm config (if we operate Keycloak)
4. If hospital SSO: notify hospital IT
5. Activate fallback local IdP if catastrophic and pre-approved

## Communication

- **Internal** (engineering): incident channel in Slack/Teams, dedicated per incident, with timestamped updates
- **Hospital IT**: email + phone for SEV-1/2; email for SEV-3
- **Hospital admin + DPO**: written notification within target window per severity
- **Patients**: never directly from us; always through the hospital

## Post-mortems

Every SEV-1 and SEV-2 gets a post-mortem within 5 business days. Template:

```
# Incident YYYY-MM-DD: short title

## Summary
What happened, in 2-3 sentences.

## Timeline
HH:MM (UTC+03) — first signal
HH:MM — paged
HH:MM — acknowledged
HH:MM — mitigation applied
HH:MM — confirmed mitigated
HH:MM — resolved

## Impact
- Users affected: ...
- Patients potentially affected: ...
- Clinical decisions potentially influenced: ...

## Root cause
What broke and why. Avoid blame; focus on system.

## What went well
What our controls / observability caught.

## What went poorly
Gaps in detection, response, communication.

## Action items
- [ ] Owner / due date / specific change

## Control changes
Mapping to NCA ECC / PDPL / IUS as applicable.
```

Post-mortems are not blameless theater — they are evidence for the regulator and for ourselves that the safety system is being tested and improved.

## Drills

- Quarterly tabletop exercise: rotate through SEV-1 scenarios (interpretive output, audit integrity, exfiltration)
- Annual full-stack disaster recovery test (restore from backup to a clean environment)
- Per-slice "chaos day": deliberately fail one dependency in staging and verify graceful degradation

## On-call documentation

Every alert in `docs/ops/02-observability.md` has a corresponding runbook entry in `docs/ops/runbooks/{alert-name}.md` (to be created during Slice 4). Each runbook is:

- 1 paragraph: what the alert means
- Checklist: first 5 minutes of investigation
- Escalation path
- Reference to related dashboards

If a runbook is missing or outdated, that's a P1 documentation issue.
