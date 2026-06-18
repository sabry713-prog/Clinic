# On-Prem Foundation Model — Decision Doc

**Status:** Decision pending (CTO).
**Context:** Stage 1 deploys **on-premise, no cloud**, inside the Kingdom, per SFDA/PDPL.
This makes the model a self-hosted open-weight model — see [[dictation-feature-scope]] and CLAUDE.md §7.

---

## Why on-prem resolves the §7 concern

CLAUDE.md §7 forbids sending PHI to an external model "unless contractually bound to in-Kingdom
processing with no training on data." That clause targets **cloud** APIs. A self-hosted model:

- runs on hospital servers in the Kingdom — **no data leaves the premises**;
- has **static weights** — it cannot "train on" your data (nothing is sent anywhere to learn from);
- needs **no vendor contract** for data handling — you control the whole stack.

On-prem is therefore the stronger compliance posture, not a workaround.

## What the model actually does here (scope is small)

The model is **not** the product. It fills two narrow slots **inside** the existing safety pipeline
(classifier → retrieval → synthesis → blocklist), and never authors clinical judgment:

1. **Classifier model-layer fallback** — only the ~5% of questions the deterministic rules don't
   decide. Rules already reach 0.95–1.00 sensitivity (see `docs/evidence-pack-e0.md`).
2. **Text synthesis** — narrative/Q&A/handoff/draft assembly of *retrieved facts*, gated by the
   blocklist. Currently a stub; the on-prem model replaces it.

Implication: a **mid-size model (7B–32B) is sufficient.** No frontier model needed.

## Candidate models (evaluate on Arabic clinical text first)

| Model | Params | Arabic strength | License | Notes |
|---|---|---|---|---|
| **ALLaM** (SDAIA) | 7B / 13B | Built for Saudi Arabic | Open (review terms) | Strong market/regulatory fit; Arabic-first |
| **Qwen2.5-Instruct** | 7B / 14B / 32B | Very strong multilingual incl. Arabic | Apache-2.0 | Excellent instruction-following; easy to serve |
| **Llama 3.1-Instruct** | 8B / 70B | Good, weaker than Qwen on Arabic | Llama license | Largest ecosystem/tooling |
| **AceGPT / Jais** | 7B–13B / 13B–30B | Arabic-specialized | Open (review terms) | Arabic-tuned; verify medical register |

**Selection criteria (in priority order):** Arabic factual fidelity → instruction-following for
strict "facts-only" prompts → license suitability for a commercial hospital product → VRAM footprint.
**Recommendation to evaluate first:** ALLaM (market fit) and Qwen2.5-14B (capability/license) head-to-head
on a held-out Arabic set, judged by blocklist pass-rate and provenance coverage — not fluency.

## Serving stack

- **Inference server:** vLLM (throughput, OpenAI-compatible API) or Ollama (simplest ops). Either
  exposes `/v1/chat/completions` on `localhost` — **no internet egress.**
- **Hardware:** one GPU node in the hospital data centre. 7B–14B at int8/4-bit fits a single
  24–48 GB GPU; 32B/70B needs more. Size after the Arabic eval picks the model.
- **Network:** the app calls the endpoint over the internal network only; egress firewalled off.

## How it plugs into the codebase (already abstracted)

The services define a `ModelProvider` protocol; today it's `StubModelProvider`. A new
`LocalModelProvider` (OpenAI-compatible HTTP client) is added and selected by env:

```
QA_MODEL_PROVIDER=local            # stub | local   (default stub)
MODEL_ENDPOINT_URL=http://localhost:8000/v1   # vLLM/Ollama, in-Kingdom
MODEL_NAME=Qwen2.5-14B-Instruct
MODEL_API_KEY=EMPTY                # local servers ignore this
```

Same pattern for the narrative service and the classifier model layer
(`LocalModelClassifier`). No rearchitecting — flip the env once the endpoint exists.

## Decision needed from CTO

1. Confirm on-prem open-weight (this doc's premise).
2. Pick the shortlist to benchmark (default: ALLaM vs Qwen2.5-14B).
3. Provision the GPU node + serving stack (vLLM or Ollama).

Once the endpoint is live: set the env above, run the **combined** rules+model eval to close the
last E0 gate (≥0.98 sensitivity EN+AR), and record it in the evidence pack.
