# Dictation (Doctor Voice → Draft Text)

**Scope (approved):** transcribe + **light reformat only**. The clinician is the
author; the system introduces **no clinical content**. AI rewriting/expansion of
a diagnosis is SaMD (CLAUDE.md §2) and is explicitly out of scope (Project 2).

**Clinician dictation only — never patient recording.** The doctor manually
dictates their own notes/assessment at their workstation (🎙 → speak → Stop).
The tool does not record the patient and has no ambient/always-on capture. Audio
is held in-memory only for the request and **discarded immediately after
transcription** — never stored or logged. Only the resulting text (which the
clinician reviews, edits, and signs) is retained.

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
