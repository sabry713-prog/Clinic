"""STT engines: stub (default) and on-prem faster-whisper.

PHI: audio bytes are never logged or persisted by this module. The
faster-whisper engine runs fully on-prem (CLAUDE.md §7) — no cloud calls.
"""
from __future__ import annotations

import os
import tempfile
from typing import Protocol

import structlog

logger = structlog.get_logger()


class TranscriptionEngine(Protocol):
    def transcribe(self, audio: bytes, language: str) -> str: ...
    def name(self) -> str: ...


class StubEngine:
    """Returns a fixed clinical-style transcript so the UX works without a model."""

    def name(self) -> str:
        return "stub-stt-v1"

    def transcribe(self, audio: bytes, language: str) -> str:
        # Stub does NOT do real speech recognition (real STT = on-prem
        # faster-whisper). It returns a SAMPLE clinical note that includes a
        # symptom, an instruction, and a requested investigation, to demonstrate
        # the intended output shape (nothing skipped). The UI labels dictation as
        # running in stub/placeholder mode.
        if language == "ar":
            return (
                "حضر المريض اليوم يشكو من صداع منذ يومين. تم الفحص السريري. "
                "الخطة: راحة في الفراش لمدة يومين، وطلب أشعة سينية، ومراجعة مع النتائج."
            )
        return (
            "Patient presented today complaining of a headache for two days. "
            "Clinical examination performed. Plan: two days bed rest, chest X-ray "
            "requested, and review with the results."
        )


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
        # The file is closed before transcription because Windows forbids a
        # second open of a still-open NamedTemporaryFile by name.
        fd, path = tempfile.mkstemp(suffix=".webm")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(audio)
            assert self._model is not None
            segments, info = self._model.transcribe(
                path,
                language=(language if language in ("en", "ar") else None),
                # Defaults (no_speech_threshold=0.6, condition_on_previous_text=True)
                # are tuned for long-form audio and can over-reject short,
                # quiet, or non-English dictation clips as "no speech" even
                # when real speech is present -- a well-documented Whisper
                # behavior, not specific to this codebase. Relaxed here for
                # short single-utterance clinical dictation:
                #  - no_speech_threshold lowered: less eager to discard a
                #    segment as silence.
                #  - condition_on_previous_text=False: a short clip has no
                #    "previous text" to condition on productively, and this
                #    flag is a known cause of whole-clip collapse when the
                #    model's first guess is low-confidence.
                no_speech_threshold=0.3,
                condition_on_previous_text=False,
                # Strips silence/non-speech before decoding, which reduces the
                # model hallucinating filler phrases into quiet gaps -- most
                # noticeable on dialectal Arabic where the model is already
                # less confident and more prone to inventing plausible-sounding
                # words when there's dead air.
                vad_filter=True,
            )
            segment_list = list(segments)
            # Numeric confidence stats only -- never audio or transcribed
            # text (PHI, CLAUDE.md §7) -- so a future empty-result report can
            # be triaged from logs alone without needing to reproduce audio.
            logger.info(
                "faster_whisper_decode",
                language_requested=language,
                language_detected=info.language,
                language_probability=round(info.language_probability, 3),
                segment_count=len(segment_list),
                duration_s=round(info.duration, 2),
            )
            return " ".join(seg.text.strip() for seg in segment_list).strip()
        finally:
            try:
                os.remove(path)
            except OSError:
                pass


def get_engine() -> TranscriptionEngine:
    from .config import settings

    if settings.transcription_engine.lower() == "faster_whisper":
        return FasterWhisperEngine(
            settings.whisper_model, settings.whisper_device, settings.whisper_compute_type
        )
    return StubEngine()
