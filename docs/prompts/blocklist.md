# Interpretive-Language Blocklist

**Version:** v1.0
**Status:** Authoritative
**Change control:** Modifications require CTO + Clinical Advisor + Regulatory Consultant approval.

## Purpose

The blocklist is the final safety gate before any generated text reaches a clinician. It scans output for words, phrases, and patterns that constitute clinical interpretation, prediction, prioritization, or recommendation. A match means the output is rejected.

## Operation

```python
from packages.blocklist import scan

result = scan(text, language="en" | "ar")
# result.passed: bool
# result.matches: list[BlocklistMatch]
#   each match: pattern, span, category, severity
```

If `result.passed` is False:
1. Log the violation with full match details (audit event `BLOCKLIST_TRIGGERED`)
2. Reject the output
3. Trigger regeneration (up to 2 retries) with stricter prompt
4. After max retries, return fallback message

## Categories

Each pattern belongs to one category for analytics. Categories:

| Category | Description |
|---|---|
| `INTERPRETIVE_VERB` | Verbs that imply judgment ("suggests", "indicates") |
| `CLINICAL_JUDGMENT_ADJECTIVE` | Adjectives that interpret values ("concerning", "abnormal") |
| `TREND_LANGUAGE` | Words characterizing change direction ("worsening", "rising") |
| `RECOMMENDATION` | Action suggestions ("consider", "should", "recommend") |
| `ALERT_LANGUAGE` | Attention-drawing terms ("watch for", "monitor for", "alert") |
| `DIAGNOSTIC_INFERENCE` | Diagnostic suggestion ("rule out", "consistent with") |
| `RISK_LANGUAGE` | Risk characterization ("at risk of", "likely to") |
| `PROGNOSTIC` | Outcome prediction ("will improve", "may deteriorate") |

## English patterns (regex, case-insensitive, word-boundary)

### INTERPRETIVE_VERB
```
\bsuggests?\b
\bindicates?\b
\bimplies\b
\bappears? to be\b
\bseems\b
\blook(s)? like\b
\bconsistent with\b
\bcompatible with\b
```

### CLINICAL_JUDGMENT_ADJECTIVE
```
\bconcerning\b
\bnoteworthy\b
\b(clinically )?significant\b      # blocks "significant" in clinical sense; do not narrate
\babnormal(ly)?\b
\belevated\b
\bdepressed\b                       # in lab/value sense
\bsuboptimal\b
\bcritical(ly)?\b                   # in clinical sense
\bsevere(ly)?\b                     # when applied to findings, not reproducing source text
```
NOTE: For codes that already carry severity (e.g., a SNOMED code `severe pneumonia` in source data), we **quote** the source text verbatim in the answer and the blocklist treats the quoted form as allowed via a quote-aware pre-pass (see "Quote handling" below).

### TREND_LANGUAGE
```
\bworsening\b
\bdeteriorat(ing|ion)\b
\bimprov(ing|ement)\b               # blocks "improving" interpretation; can describe documented status via quote
\b(up|down) ?trend(ing)?\b
\btrending (up|down|upward|downward)\b
\brising\b
\bfalling\b
\bdeclin(ing|e)\b
\bclimb(ing)?\b                     # in clinical value sense
\bdropp(ing|ed)\b                   # in clinical value sense (block when next to lab term)
```

### RECOMMENDATION
```
\bconsider(ing)?\b
\brecommend(ed|ation)?\b
\badvise(d)?\b
\bshould (be|consider|order|hold|avoid|start|stop)\b
\bsuggest(ed)?\b
\bnext step\b
\bnext steps\b
\bplan(ning)? to\b                  # context-dependent; allowed if quoting a documented plan
\bwarrant(s|ed)?\b
```

### ALERT_LANGUAGE
```
\bwatch (out )?for\b
\bmonitor for\b
\bbe aware\b
\balert\b
\bflag\b                            # in clinical sense
\bcaution\b
\bwarn(ing)?\b
\battention to\b
```

### DIAGNOSTIC_INFERENCE
```
\brule out\b
\bdifferential( diagnosis)?\b
\bpossible diagnosis\b
\bcould be\b                        # often interpretive
\bmight be\b
\bmay represent\b
\blikely (diagnosis|cause|due to)\b
```

### RISK_LANGUAGE
```
\bat risk (of|for)\b
\b(high|low|increased) risk\b
\blikely to (develop|deteriorate|need|require)\b
\brisk of\b
\brisk for\b
\bprobability of (developing|having)\b
```

### PROGNOSTIC
```
\bwill (improve|deteriorate|recover|need|require)\b
\bwill develop\b
\bexpect(ed)? to\b
\banticipate(d)?\b
\bprognosis\b
```

## Arabic patterns

These mirror the English categories. Final list reviewed by the Arabic-speaking clinical advisor.

### INTERPRETIVE_VERB
```
\bيشير إلى\b
\bيدل على\b
\bيعكس\b
\bيوحي\b
\bيبدو\b
\bمتوافق مع\b
```

### CLINICAL_JUDGMENT_ADJECTIVE
```
\bمقلق\b
\bخطير\b                            # in clinical sense
\bغير طبيعي\b
\bمرتفع\b                           # without restating the lab's own range
\bمنخفض\b                           # without restating the lab's own range
\bحرج\b
\bشديد\b                            # when interpretive, not when quoting
```

### TREND_LANGUAGE
```
\bيتدهور\b
\bيتحسن\b
\bتدهور\b
\bتحسن\b
\bارتفاع\b                          # in trend sense
\bانخفاض\b                          # in trend sense
\bتراجع\b
```

### RECOMMENDATION
```
\bأنصح\b
\bأوصي\b
\bيُنصح\b
\bيُوصى\b
\bالخطوة التالية\b
\bالخطوات التالية\b
\bيجب\b                             # context-dependent
\bينبغي\b
```

### ALERT_LANGUAGE
```
\bانتبه إلى\b
\bحذار\b
\bتحذير\b
\bراقب\b                            # in clinical-attention sense
```

### DIAGNOSTIC_INFERENCE
```
\bتشخيص محتمل\b
\bقد يكون\b
\bربما\b
\bمحتمل أن\b
```

### RISK_LANGUAGE
```
\bمعرض لخطر\b
\bخطر الإصابة\b
\bاحتمال\b
```

### PROGNOSTIC
```
\bالإنذار\b
\bمن المتوقع\b
\bسوف يحتاج\b
\bسوف يتدهور\b
```

## Quote handling

Source data sometimes contains words that match the blocklist (e.g., a SNOMED code with `display = "severe sepsis"`, or a progress note that says "patient is concerning"). When the application **quotes** source content verbatim, the blocklist must allow it.

Convention:
- Source quotes are wrapped in `«` `»` (or another non-printable marker that the model is instructed to use)
- Pre-pass strips the markers and removes the wrapped span from blocklist scanning
- Post-pass re-applies appropriate quote display formatting

If the model fails to use the quote markers, the output is rejected and regenerated.

## False-positive mitigation

Some phrases are blocklisted broadly and may produce false positives on legitimate factual restatement. Mitigations:

1. **"elevated" / "low"** — allowed if followed within the same sentence by an explicit reference range from the source. The blocklist contains a context rule:
   ```
   if pattern == "elevated" or pattern == "low":
       if sentence contains "reference range" or "range" near the value:
           # treat as allowed in this context if value is quoted alongside range
           # otherwise still block
           ...
   ```
   In practice, the safer pattern is: do not characterize at all. Use "Value X (reference range A-B)" instead.

2. **"improving"** — blocked unless quoting a progress note that says it. The model should write "Documented in 24 May progress note as «improving»."

## Tests

The blocklist package ships with a comprehensive test suite. The CI requires:
- 100% pass on the canonical block-test corpus (`tests/blocklist/should_block.txt`)
- 0 false positives on the allowed corpus (`tests/blocklist/should_allow.txt`)

Both corpora are versioned alongside the blocklist itself.

## Audit

Every blocklist trigger writes an audit event with:
- The original text (which would be PHI-adjacent, so kept in restricted audit access tier)
- The matched pattern(s)
- The category
- The action taken (retry / fallback)

## Versioning

This file's first line declares the active version. Each `qa_interaction` and `narrative_output` row records the blocklist version applied.
