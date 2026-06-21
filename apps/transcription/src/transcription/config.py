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


settings = Settings()
