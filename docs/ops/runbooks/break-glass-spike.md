# Runbook: Break-Glass Spike

**Alert**: `BreakGlassSpike` — `break_glass_access_total` > 5 per hour
**Severity**: SEV-2 (MEDIUM)
**Recipient**: Hospital admin + DPO

## What this means

Break-glass is the emergency access mechanism that allows a clinician to access a patient's record outside their normal care team authorization. It is intended for genuine emergencies (e.g., a patient is brought in unconscious with no assigned care team). More than 5 uses per hour is statistically anomalous and may indicate misuse, credential sharing, or a configuration error in the RBAC rules that is causing legitimate accesses to fall through to break-glass unnecessarily.

## First 5 minutes

1. **Check who is using break-glass** and for which patients:
   ```sql
   SELECT ae.user_id, ae.patient_id, ae.ts, ae.details->>'reason' AS reason
     FROM audit.event ae
    WHERE ae.action = 'BREAK_GLASS_ACCESS'
      AND ae.ts > now() - INTERVAL '1 hour'
    ORDER BY ae.ts DESC;
   ```
2. **Check if it is the same user repeatedly** (credential misuse) or spread across many users (RBAC configuration issue):
   ```sql
   SELECT user_id, count(*) AS n
     FROM audit.event
    WHERE action = 'BREAK_GLASS_ACCESS'
      AND ts > now() - INTERVAL '1 hour'
    GROUP BY 1
    ORDER BY 2 DESC;
   ```
3. **Check the RBAC configuration** — did a recent change accidentally remove patients from a care team assignment?
4. **Contact the hospital admin** to identify whether the users involved are in genuine emergency situations.
5. **Check for the documented emergency reason** — every break-glass event requires a reason string; missing/generic reasons are a red flag.

## Escalation path

1. On-call engineer — assess within 15 minutes
2. Hospital admin — notify immediately (they manage care team assignments)
3. DPO — notify within 1 hour (PHI access audit obligation)
4. If evidence of misuse: escalate to SEV-1 (suspected PHI exfiltration protocol)

## Related dashboards

- Security: [Grafana /d/security](http://grafana.hospital.local/d/security)
