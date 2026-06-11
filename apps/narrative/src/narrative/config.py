from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file="../../.env", extra="ignore")

    narrative_grpc_port: int = 5001
    database_url: str = ""
    otel_exporter_otlp_endpoint: str = "http://localhost:4318"
    otel_service_name: str = "clinical-copilot-narrative"
    node_env: str = "development"


settings = Settings()
