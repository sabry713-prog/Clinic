# Dictation (Doctor Voice → Draft Text)

**Scope (approved):** transcribe + **light reformat only**. The clinician is the
author; the system introduces **no clinical content**.

**Clinician dictation only — never patient recording, here.** The doctor
manually dictates their own notes/assessment at their workstation (🎙 → speak →
Stop). This flow does not record the patient. Audio is held in-memory only for
the request and **discarded immediately after transcription** — never stored or
logged. Only the resulting text (which the clinician reviews, edits, and signs)
is retained.

> **Update:** the "no ambient/always-on capture" boundary that used to be stated
> here (as "Project 2, deferred") has since been scoped and built — see
> [`docs/architecture/ambient-capture.md`](./ambient-capture.md) and
> [`docs/prompts/ambient-segmentation-prompt.md`](../prompts/ambient-segmentation-prompt.md).
> That feature is a **separate, explicit-start/explicit-stop, consent-gated**
> recording of the clinician<->patient conversation — still no always-on/
> background capture, and still no AI-authored clinical content (segmentation
> only relocates the speaker's own verbatim words; CLAUDE.md §2 still applies in
> full). This dictation flow is unchanged.
>
> **Further update:** a second, separate mechanism now exists for the two
> non-judgment ambient sections (Chief Complaint/History) — see
> [`docs/prompts/ambient-condensation-prompt.md`](../prompts/ambient-condensation-prompt.md).
> Unlike segmentation's verbatim-substring check, condensation genuinely
> paraphrases text, gated by a **blocklist scan + content-word containment
> check** instead (every word in the condensed output must already appear in
> the source). Assessment/Plan are permanently excluded from this path and
> remain verbatim-only, enforced in three independent places. Pending the same
> sign-off gate as segmentation.
>
> **Third update:** an Arabic dictation now also auto-triggers an English
> translation preview for every section, reusing the already-built Medical
> Interpreter pipeline — see
> [`docs/prompts/interpreter-prompt.md`](../prompts/interpreter-prompt.md#ambient-scribe-call-site).
> Translation has no automated fidelity check the way condensation's
> word-containment does (different language entirely), so the server **never
> trusts client-submitted translated text** — it always re-derives its own
> translation, server-side, from text that already passed the verbatim/
> condensation check. Chief Complaint/History can be submitted as English;
> Assessment/Plan get a read-only preview only, never a submittable
> translation. Pending the same sign-off gate as segmentation and
> condensation.
>
> **Fourth update:** the raw transcript now also gets an automatic, read-only
> "medical terms mentioned" reference glossary shown alongside it — see
> [`docs/prompts/ambient-term-extraction-prompt.md`](../prompts/ambient-term-extraction-prompt.md).
> Every term is server-side verbatim-verified the same way segmentation
> verifies section text, but unlike segmentation/condensation/translation this
> output is never submitted into a draft or re-verified at draft-creation time
> — it never becomes part of the record. Terms are shown without their
> negation/duration qualifiers by design (e.g. "no fever" surfaces as
> "fever"), so the glossary is explicitly labeled reference-only and always
> shown next to the full transcript, never as a standalone symptom list.
> Pending the same sign-off gate as the rest of ambient capture.

## Flow

```
Doctor speaks (mic) ──▶ browser MediaRecorder ──▶ base64 audio
   ──▶ POST /api/v1/patients/:id/transcribe  (core, RBAC-scoped, audited)
   ──▶ transcription service (on-prem STT)  ──▶ raw transcript
   ──▶ light_reformat (punctuation/filler only)  ──▶ text
   ──▶ inserted into the editable Draft (E6) for the clinician to edit + sign
```

## Components

- **`apps/transcription`** — FastAPI service (port 5003). `POST /transcribe`
  `{audio_base64, language}` → `{text, engine}`. Engine is config-gated:
  `stub` (canned text, default) or `faster_whisper` (on-prem GPU).
- **`light_reformat`** — deterministic cleanup (filler removal, whitespace,
  capitalisation, terminal punctuation). Unit-tested; never semantic rewriting.
- **Core proxy** — `DraftService.transcribe` forwards to the service;
  `DICTATION_TRANSCRIBED` audit logs **metadata only** (engine, char count) —
  never audio or transcript content.
- **Web** — mic record/stop in `DraftPanel`; transcript is appended to the
  clinician-editable draft text.

## On-prem STT engine: faster-whisper large-v3

Dictated audio is PHI → STT runs **on-prem/in-Kingdom, never a cloud API**
(CLAUDE.md §7). To enable on the GPU host:

```
# install the optional engine on the transcription host
uv sync --extra whisper        # pulls faster-whisper

# .env
TRANSCRIPTION_ENGINE=faster_whisper
WHISPER_MODEL=large-v3
WHISPER_DEVICE=cuda
WHISPER_COMPUTE_TYPE=float16
```

No application code changes — same flip-a-switch pattern as the on-prem LLM
(`docs/architecture/on-prem-model.md`). Until then it runs in `stub` mode so the
UX is testable now.

## PHI handling

- Audio is never logged or persisted; it lives only in-memory for the duration
  of the request and is discarded after transcription.
- Transcript content is never logged (audit records metadata only).
- All processing is on-prem; no third-party/cloud STT.
