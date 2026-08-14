# Self-Hosted LLM Swap — Executive Demo Artifact (S4.2)

**What this is:** a demo talking point, not live infra. No self-hosted
endpoint is stood up for the demo. This page shows the *exact* configuration
diff that moves the system from the CTO-approved DeepSeek cloud deviation
back on-prem — proof that the abstraction is config-only, not a code change
or a re-platforming project.

**Reference design:** `docs/architecture/on-prem-model.md` (the on-prem
posture this swap returns to; see its deviation notice for the current
cloud state and the open compliance actions).

---

## The swap, in four lines

```diff
  # .env — before (current, CTO-approved deviation)
- ORCHESTRATOR_MODEL_PROVIDER=deepseek
- DEEPSEEK_API_KEY=sk-…            # public cloud, api.deepseek.com

  # .env — after (self-hosted, in-Kingdom)
+ ORCHESTRATOR_MODEL_PROVIDER=local
+ MODEL_ENDPOINT_URL=https://llm.hospital.sa/v1
+ MODEL_NAME=llama-3.3-70b-instruct
+ PHI_INKINGDOM_HOSTS=llm.hospital.sa
```

That is the whole change. Restart the services and every LLM call —
orchestrator agent prose, Q&A synthesis, narrative synthesis, classifier
fallback — now terminates at the hospital's own endpoint.

## Why it is only four lines

| Line | What it switches | Where it's read |
|---|---|---|
| `ORCHESTRATOR_MODEL_PROVIDER=local` | The orchestrator's provider selection (deepseek → local OpenAI-compatible client). `stub` also exists for CI. | `services/orchestrator/config.py`, `model_router.py` |
| `MODEL_ENDPOINT_URL` | The single OpenAI-compatible base URL shared by apps/qa, apps/narrative, apps/transcription reformat — one endpoint moves them all. | `ModelProvider` implementations in each service |
| `MODEL_NAME` | Model id sent in the chat-completions payload. | Same providers |
| `PHI_INKINGDOM_HOSTS` | The fail-closed egress guard: `packages/phi-guard` refuses to send prompt PHI to any host not declared in-Kingdom. The swap does not weaken it — it *satisfies* it. | `packages/phi-guard` (`classify_endpoint`) |

Key architectural points the demo should land:

1. **The model is not the product.** It fills two narrow slots inside the
   safety pipeline (classifier fallback for the ~5% of questions rules don't
   decide, and prose synthesis of already-retrieved facts) — everything
   factual stays deterministic Cypher/SQL. Swapping the model swaps the
   wording layer, not the knowledge layer.
2. **Every generative path keeps its guards regardless of provider:**
   blocklist scan, provenance verification, PHI egress fail-closed,
   audit-logging. Provider choice never bypasses a safety control.
3. **Static weights = no training on patient data.** No vendor contract
   needed for data handling; the compliance posture in
   `docs/architecture/on-prem-model.md` is restored by configuration.
4. **Sizing guidance:** per the on-prem decision doc, a 7B–32B model is
   sufficient for the two slots; `llama-3.3-70b-instruct` is shown as a
   comfortable ceiling, not a requirement. Reasoning-model token-budget
   caveats from the deviation notice don't apply to a standard instruct
   model.

## Demo script (30 seconds)

1. Show this diff on screen.
2. Show `services/orchestrator/model_router.py` selecting on
   `ORCHESTRATOR_MODEL_PROVIDER` — the seam.
3. Show `packages/phi-guard` refusing an undeclared host (unit test), then
   passing once `PHI_INKINGDOM_HOSTS=llm.hospital.sa` is set — the guard
   travels with the swap.
4. Close: "The differentiators you just saw — evidence chains, claim
   integrity, the audit hash-chain — are all deterministic code. The LLM is
   a wording service behind a config flag. Your hospital, your model, your
   data boundary."

## Verification hook (no live endpoint needed)

`ORCHESTRATOR_MODEL_PROVIDER=stub` exercises the identical pipeline with a
canned provider — the same seam, proven in CI on every run
(`services/orchestrator/tests/test_model_router.py`). The stub and the
local provider differ only in where the HTTP request would go.
