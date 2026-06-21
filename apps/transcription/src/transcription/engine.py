"""STT engines: stub (default) and on-prem faster-whisper.

PHI: audio bytes are never logged or persisted by this module. The
faster-whisper engine runs fully on-prem (CLAUDE.md §7) — no cloud calls.
"""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Protocol


class TranscriptionEngine(Protocol):
    def transcribe(self, audio: bytes, language: str) -> str: ...
    def name(self) -> str: ...


class StubEngine:
    """Returns a fixed clinical-style transcript so the UX works without a model."""

    def name(self) -> str:
        return "stub-stt-v1"

    def transcribe(self, audio: bytes, language: str) -> str:
        # Stub does NOT do real speech recognition — it returns a clearly-labelled
        # placeholder so it is never mistaken for an (inaccurate) transcription.
        # Real speech-to-text requires the on-prem faster-whisper engine.
        if language == "ar":
            return "[نص توضيحي — التحويل الفعلي للكلام يتطلب تشغيل محرك faster-whisper المحلي.]"
        return "[Placeholder text — real speech-to-text requires the on-prem faster-whisper engine.]"


class FasterWhisperEngine:
    """On-prem faster-whisper. Lazy-loads the model on first use."""

    def __init__(self, model: str, device: str, compute_type: str) -> None:
        self._model_name = model
        self._device = device
        self._compute_type = compute_type
        self._model = None  # loaded lazily

    def name(self) -> str:
        return f"faster-whisper:{self._model_name}"

    def _ensure_model(self) -> None:
        if self._model is None:
            from faster_whisper import WhisperModel  # optional dep, on-prem only

            self._model = WhisperModel(
                self._model_name, device=self._device, compute_type=self._compute_type
            )

    def transcribe(self, audio: bytes, language: str) -> str:
        self._ensure_model()
        # Write to a temp file (audio bytes never logged); transcribe; clean up.
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=True) as f:
            f.write(audio)
            f.flush()
            assert self._model is not None
            segments, _info = self._model.transcribe(
                f.name, language=(language if language in ("en", "ar") else None)
            )
            return " ".join(seg.text.strip() for seg in segments).strip()
        _ = Path  # keep import used if trimmed


def get_engine() -> TranscriptionEngine:
    from .config import settings

    if settings.transcription_engine.lower() == "faster_whisper":
        return FasterWhisperEngine(
            settings.whisper_model, settings.whisper_device, settings.whisper_compute_type
        )
    return StubEngine()
