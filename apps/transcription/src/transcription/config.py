from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file="../../.env", extra="ignore")

    otel_service_name: str = "clinical-copilot-transcription"
    node_env: str = "development"

    # STT engine: "stub" (default) or "faster_whisper" (on-prem GPU).
    # Dictated audio is PHI — this engine MUST run on-prem/in-Kingdom (CLAUDE.md §7).
    transcription_engine: str = "stub"
    whisper_model: str = "large-v3"
    whisper_device: str = "cpu"        # "cuda" on the GPU host
    whisper_compute_type: str = "int8"  # e.g. "float16" on GPU

    # Reformat mode: "light" (deterministic cleanup) or "llm" (faithful on-prem
    # reformat — see docs/prompts/reformat-prompt.md). Falls back to light if the
    # on-prem model is unavailable. The model endpoint MUST be in-Kingdom (§7).
    transcription_reformat: str = "light"
    model_endpoint_url: str = "http://localhost:8000/v1"
    model_name: str = ""
    model_api_key: str = "EMPTY"
    model_timeout_s: float = 30.0

    # Ambient segmentation mode: "stub" (default — everything unclassified) or
    # "llm" (on-prem classification — see docs/prompts/ambient-segmentation-prompt.md).
    # Reuses the same model_endpoint_url/model_name/model_api_key as reformat above.
    transcription_segmentation: str = "stub"

    # Ambient condensation mode: "stub" (default — safe subtractive-only
    # filler-strip, see condense.py) or "llm" (real paraphrase, gated by
    # blocklist + word-containment — see docs/prompts/ambient-condensation-prompt.md).
    # Independent toggle from transcription_segmentation on purpose — a site
    # may want live segmentation without opting into live condensation, or
    # vice versa. Not yet approved for real-patient use (pending CTO +
    # Clinical Advisor + Regulatory Consultant sign-off).
    transcription_condensation: str = "stub"

    # Ambient medical-term extraction mode: "stub" (default -- always returns
    # an empty reference list) or "llm" (on-prem term-spotting, verbatim-
    # verified -- see docs/prompts/ambient-term-extraction-prompt.md).
    # Independent toggle from segmentation/condensation on purpose. Reference-
    # only output -- never submitted into a draft. Not yet approved for
    # real-patient use (pending CTO + Clinical Advisor + Regulatory Consultant
    # sign-off).
    transcription_term_extraction: str = "stub"


settings = Settings()
