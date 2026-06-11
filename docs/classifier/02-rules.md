# 02 — Classifier Rules

**Version:** v1.0
**Status:** Authoritative
**Change control:** CTO + Clinical Advisor approval required.

## Rule format

Each rule has:
- `id` — stable identifier (e.g., `TREND_INTERPRETATION:is_X_getting_worse`)
- `category` — one of the refusal categories or `ALLOWED_FACTUAL`
- `language` — `en` | `ar` | `any`
- `pattern` — regex (case-insensitive, anchored as appropriate)
- `decision` — `REFUSED` | `ALLOWED` | `NEUTRAL`
- `examples_positive` — text that should match
- `examples_negative` — text that should NOT match (false-positive guards)

Rules are evaluated in order of specificity. The first rule that fires with `REFUSED` short-circuits the classifier. ALLOWED rules require no contradicting REFUSED rule before they short-circuit.

If no rule fires decisively, the classifier falls through to the model layer.

## REFUSED rules

### TREND_INTERPRETATION

```
id: TREND_INTERPRETATION:is_X_getting_worse
language: en
pattern: \b(is|are|has|have)\b.{0,30}\b(getting|becoming|trending|growing)\b.{0,20}\b(worse|better|abnormal|elevated|low)\b
positive:
  - "Is the kidney function getting worse?"
  - "Are her labs trending abnormal?"
negative:
  - "Is the patient on metformin?" (no trend keyword)
```

```
id: TREND_INTERPRETATION:improving_or_worsening
language: en
pattern: \b(improv|worsen|deteriorat|recover)(ing|ed)?\b
positive:
  - "Is he improving?"
  - "Has the patient been deteriorating?"
negative:
  - "The note says «patient is improving»" (handled via quote markers, but classifier doesn't allow it as factual either — refuse and offer the source note)
```

```
id: TREND_INTERPRETATION:trend_general
language: en
pattern: \btrend(ing|s)?\b
positive:
  - "What's the creatinine trend?"
  - "How is the BP trending?"
```

```
id: TREND_INTERPRETATION:stable_or_unstable
language: en
pattern: \b(stable|unstable|stabili[sz]ing)\b.{0,40}\?
positive:
  - "Is he stable?"
  - "Is her renal function stable?"
```

```
id: TREND_INTERPRETATION:ar_tadahwur
language: ar
pattern: \b(يتدهور|يتحسن|تدهور|تحسن|اتجاه)\b
positive:
  - "هل تتدهور وظائف الكلى؟"
```

### DIAGNOSTIC_SUGGESTION

```
id: DIAGNOSTIC_SUGGESTION:could_be_or_might_be
language: en
pattern: \b(could|might|may|possibly)\b.{0,20}\b(be|have|indicate|represent|suggest)\b
positive:
  - "Could this be sepsis?"
  - "Might he have pneumonia?"
negative:
  - "Could you tell me the BP?" (no diagnostic noun)
```

```
id: DIAGNOSTIC_SUGGESTION:what_is_causing
language: en
pattern: \bwhat (is|are|might|could) (caus|causing|behind)\b
positive:
  - "What is causing the fever?"
  - "What might be causing the rash?"
```

```
id: DIAGNOSTIC_SUGGESTION:diagnosis_question
language: en
pattern: \b(diagnos(is|e)|differential|ddx)\b
positive:
  - "What's the diagnosis?"
  - "What's the differential?"
negative:
  - "What's the admitting diagnosis?" (ALLOWED — see below)
```

```
id: DIAGNOSTIC_SUGGESTION:ar_tashkhis
language: ar
pattern: \b(تشخيص|التشخيص|الأسباب المحتملة)\b
negative:
  - "ما هو تشخيص الدخول؟" (admitting diagnosis — handled by ALLOWED rule first)
```

### RISK_ASSESSMENT

```
id: RISK_ASSESSMENT:at_risk
language: en
pattern: \b(at|in) (risk|danger) (of|for|to)\b
positive:
  - "Is the patient at risk of AKI?"
  - "Is she in danger of falling?"
```

```
id: RISK_ASSESSMENT:how_sick_serious
language: en
pattern: \bhow (sick|serious|severe|bad|critical|stable)\b
positive:
  - "How sick is this patient?"
  - "How serious is this condition?"
```

```
id: RISK_ASSESSMENT:ar_khatar
language: ar
pattern: \b(معرض ل?خطر|في خطر|مدى الخطورة)\b
```

### TREATMENT_RECOMMENDATION

```
id: TREATMENT_RECOMMENDATION:what_should_I
language: en
pattern: \bwhat (should|would|could|do|do you|do I|can) (I|we|you|the doctor)\b.{0,40}\b(give|prescribe|do|order|start|stop|hold|increase|decrease|administer|recommend)\b
positive:
  - "What should I give for his pain?"
  - "What should I prescribe?"
```

```
id: TREATMENT_RECOMMENDATION:should_we
language: en
pattern: \bshould (I|we|you|the team)\b
positive:
  - "Should I increase the dose?"
  - "Should we order a CT?"
```

```
id: TREATMENT_RECOMMENDATION:recommend_or_suggest
language: en
pattern: \b(recommend|suggest|advise)\b
positive:
  - "What do you recommend?"
  - "Any suggestions for treatment?"
```

```
id: TREATMENT_RECOMMENDATION:next_step
language: en
pattern: \bnext step(s)?\b
```

```
id: TREATMENT_RECOMMENDATION:ar_madha_a3ti
language: ar
pattern: \b(ماذا أعطي|ماذا أصف|ماذا أفعل|الخطوة التالية|توصية)\b
```

### MEDICATION_SAFETY_JUDGMENT

```
id: MEDICATION_SAFETY_JUDGMENT:safe_in
language: en
pattern: \b(safe|ok|appropriate|contraindicated)\b.{0,30}\b(in|for|with|despite|given)\b
positive:
  - "Is metformin safe in CKD stage 4?"
  - "Is this dose appropriate for his age?"
```

```
id: MEDICATION_SAFETY_JUDGMENT:will_interact
language: en
pattern: \b(interact|interaction)\b
positive:
  - "Will this interact with his current medications?"
  - "Any drug interactions?"
```

```
id: MEDICATION_SAFETY_JUDGMENT:dose_adjustment
language: en
pattern: \b(adjust|reduce|increase) (the )?dose\b
positive:
  - "Should I adjust the dose?"
  - "Do I need to reduce the dose?"
```

### DIFFERENTIAL_DIAGNOSIS

(Mostly covered by DIAGNOSTIC_SUGGESTION rules above.)

```
id: DIFFERENTIAL_DIAGNOSIS:what_could_cause
language: en
pattern: \bwhat (could|might|may) (cause|explain|account for)\b
```

### PROGNOSTIC_QUESTION

```
id: PROGNOSTIC_QUESTION:will_he
language: en
pattern: \bwill (he|she|the patient|they) (need|require|develop|deteriorate|recover|improve|die|survive)\b
```

```
id: PROGNOSTIC_QUESTION:how_long
language: en
pattern: \bhow long (until|before|will it take)\b
positive:
  - "How long until discharge?"
  - "How long will the recovery take?"
```

```
id: PROGNOSTIC_QUESTION:prognosis
language: en
pattern: \bprognosis\b
```

### RED_FLAG_IDENTIFICATION

```
id: RED_FLAG_IDENTIFICATION:concerning
language: en
pattern: \b(anything )?(concerning|worrying|alarming|of concern)\b
positive:
  - "Is there anything concerning in this chart?"
  - "Anything worrying about her vitals?"
```

```
id: RED_FLAG_IDENTIFICATION:should_I_worry
language: en
pattern: \bshould I (worry|be concerned|be worried)\b
```

```
id: RED_FLAG_IDENTIFICATION:red_flag
language: en
pattern: \bred flag(s)?\b
```

```
id: RED_FLAG_IDENTIFICATION:ar_qalaq
language: ar
pattern: (مثير للقلق|يستدعي القلق|\bمقلق(ة)?\b|\bالقلق\b|\bقلق(ة)?\b|\bخطير(ة)?\b)
positive:
  - "هل وضعه يستدعي القلق؟"
  - "هل الكرياتينين في مستوى مثير للقلق؟"
  - "هل التحاليل مقلقة؟"
  - "هل وضعه خطير؟"
```

```
id: RED_FLAG_IDENTIFICATION:ar_tabiei
language: ar
pattern: \bهل\b.{0,60}\bطبيعي(ة|ه)?\b
positive:
  - "هل نسبة السكر طبيعية؟"
negative:
  - "ما هي قيم الكرياتينين الموثقة؟" (factual lookup — must remain ALLOWED)
```

### COMPARATIVE_JUDGMENT

```
id: COMPARATIVE_JUDGMENT:worse_than
language: en
pattern: \b(worse|better|higher|lower) than\b
positive:
  - "Is this BP worse than yesterday's?"
  - "Is the hemoglobin lower than last month?"
```

```
id: COMPARATIVE_JUDGMENT:compared_to
language: en
pattern: \bcompared to\b
positive:
  - "How does today's creatinine compare to last admission?"
negative:
  - "Show me labs from this admission compared to last admission." (this is a borderline case; classifier should refuse with COMPARATIVE_JUDGMENT and offer both sets of values)
```

### OUT_OF_SCOPE

```
id: OUT_OF_SCOPE:multi_patient
language: en
pattern: \b(all patients|all the patients|every patient|across patients|cohort|patients with)\b
positive:
  - "How are all CKD patients doing this month?"
  - "Show me all patients with elevated creatinine."
```

```
id: OUT_OF_SCOPE:statistics
language: en
pattern: \b(average|mean|median|how many patients|count of patients|percentage of patients)\b
```

```
id: OUT_OF_SCOPE:ward_aggregate
language: en
pattern: \b(in the ward|in the unit|on the floor|in ICU)\b.{0,30}\bhow many\b
```

## ALLOWED rules (short-circuit allow only after no REFUSED match)

```
id: ALLOWED_FACTUAL:value_lookup
language: en
pattern: \bwhat (is|was|are|were) (the |his |her |their )?(last|latest|recent|current|first|admitting|documented)?\s?(value of |level of )?\b
positive:
  - "What is the last creatinine?"
  - "What was the admitting diagnosis?"
  - "What are the active medications?"
```

```
id: ALLOWED_FACTUAL:show_or_list
language: en
pattern: \b(show|list|give|display)\s?(me )?\b
positive:
  - "Show me all creatinine values this admission."
  - "List the active medications."
```

```
id: ALLOWED_FACTUAL:when_or_date
language: en
pattern: \bwhen (was|did|is)\b
positive:
  - "When was the last admission?"
  - "When did he start metformin?"
```

```
id: ALLOWED_FACTUAL:has_event_occurred
language: en
pattern: \b(has|have|did) (he|she|the patient|they)\b.{0,20}\b(had|been|received|undergone|been admitted|been diagnosed)\b
positive:
  - "Has the patient had pneumonia before?"
  - "Has he been admitted in the last year?"
```

## Quote-aware preprocessing

Before rule matching, replace quoted source content (text between `«` and `»` if present) with a sentinel token `__QUOTE__` so the classifier doesn't refuse on quoted phrases. The classifier looks at the user's question, which by definition is the clinician's own words — quotes are unlikely there, but the preprocessing is a defensive habit.

## Tests

Each rule ships with positive and negative examples (above). The CI runs:
- Every positive example must match its rule
- Every negative example must NOT match any REFUSED rule (or must match the more specific ALLOWED rule that overrides)

Plus a holdout corpus: 200 hand-labeled questions per language, evaluated for the metrics in `docs/classifier/03-evaluation.md`.

## Adding new rules

Process:
1. Open PR with new rule + positive/negative examples
2. Clinical advisor reviews
3. CTO approves merge
4. CI runs full test suite
5. Version increments
