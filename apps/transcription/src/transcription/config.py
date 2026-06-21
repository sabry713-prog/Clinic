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


settings = Settings()
