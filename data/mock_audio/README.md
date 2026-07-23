# Mock audio / transcript fixtures

Synthetic consultations for local testing of the ambient scribe. No real
patient data — names, MRNs and IDs are fictional and non-resolvable.

## Why transcripts and not audio files

The scribe pipeline takes **text chunks**, not audio: the browser does
speech-to-text locally (Web Speech API) and posts recognised text to the
orchestrator. So the useful fixture is a timed transcript, which also keeps
the repo free of large binaries and makes tests deterministic.

Each `*.transcript.json` has:

```jsonc
{
  "id": "chest-pain-01",
  "title": "...",
  "expected_symptoms": ["chest pain"],   // what the Smart Checklist should catch
  "chunks": [
    { "at_ms": 0, "speaker": "clinician", "text": "..." }
  ]
}
```

`at_ms` is the offset from the start of the consultation, so the UI can replay
a fixture at realistic pace.

## Using them

**In the UI** — the left pane's source selector lists these fixtures; pick one
and press Record to replay it instead of using the microphone. Useful when you
have no mic, or want a repeatable demo.

**Against the API**:

```bash
curl -s -X POST http://localhost:5010/scribe/structure \
  -H 'Content-Type: application/json' \
  -d "{\"transcript\": \"$(python3 -c "
import json;d=json.load(open('data/mock_audio/chest-pain-01.transcript.json'))
print(' '.join(c['text'] for c in d['chunks']))")\"}"
```

**Checklist only** (deterministic, no model call, no PHI egress):

```bash
curl -s 'http://localhost:5010/scribe/checklist?transcript=patient%20reports%20chest%20pain%20and%20fever'
```

## Adding a real audio file

If you do need audio (e.g. to test a different STT engine), drop a `.webm` or
`.wav` here alongside a matching `.transcript.json` as ground truth. Keep it
short — these are fixtures, not a corpus.
