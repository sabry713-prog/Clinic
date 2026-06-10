# Runbook: Classifier Confidence Drop

**Alert**: `ClassifierConfidenceDrop` — mean classifier confidence drops > 10% week-over-week
**Severity**: SEV-3 (MEDIUM)
**Recipient**: Tech lead

## What this means

The query classifier's mean confidence score has dropped more than 10% compared to the same window last week. This means more questions are landing in the uncertain zone (0.5–0.85), where the system defaults to REFUSED. The immediate user impact is more false positives (factual questions being refused). The safety concern is that if confidence is dropping, classifier rule coverage may be eroding relative to actual query patterns, which could eventually allow interpretive questions through.

## First 5 minutes

1. **Check the confidence histogram** over the past 7 days:
   ```
   Grafana → Q&A Safety dashboard → Classifier confidence histogram
   ```
2. **Check if new question patterns** are appearing that do not match any rule:
   ```sql
   SELECT details->>'refusal_category' AS category, count(*) AS n
     FROM audit.event
    WHERE action = 'QA_CLASSIFIED'
      AND (details->>'layer') = 'model'
      AND (details->>'confidence')::float < 0.85
    GROUP BY 1
    ORDER BY 2 DESC
   LIMIT 20;
   ```
3. **Check if the classifier package version changed** in the last deploy.
4. **Run the classifier evaluation harness** against the holdout corpus:
   ```bash
   just eval-classifier lang=en
   just eval-classifier lang=ar
   ```
5. **Check for any new query languages or terminology** that might not be covered by existing rules.

## Escalation path

1. Tech lead — investigate within 1 business day
2. If evaluation harness fails (sensitivity < 0.98): escalate to engineering lead + clinical advisor
3. Add new classifier rules under the change-control process (CLAUDE.md §6)

## Related dashboards

- Q&A Safety: [Grafana /d/qa-safety](http://grafana.hospital.local/d/qa-safety)
