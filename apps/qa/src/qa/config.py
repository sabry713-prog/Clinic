from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file="../../.env", extra="ignore")

    qa_grpc_port: int = 5002
    database_url: str = ""
    otel_exporter_otlp_endpoint: str = "http://localhost:4318"
    otel_service_name: str = "clinical-copilot-qa"
    node_env: str = "development"

    # Model provider: "stub" (default) or "local" (on-prem OpenAI-compatible endpoint).
    # See docs/architecture/on-prem-model.md. Endpoint must be in-Kingdom (no cloud).
    qa_model_provider: str = "stub"
    model_endpoint_url: str = "http://localhost:8000/v1"
    model_name: str = ""
    model_api_key: str = "EMPTY"
    model_timeout_s: float = 30.0


settings = Settings()
