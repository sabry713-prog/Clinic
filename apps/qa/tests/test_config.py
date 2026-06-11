"""Tests for Settings env loading — DATABASE_URL from .env file vs process env."""
from __future__ import annotations

from pathlib import Path

import pytest

from src.qa.config import Settings


def test_database_url_defaults_empty(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    settings = Settings(_env_file=tmp_path / "missing.env")
    assert settings.database_url == ""


def test_database_url_loaded_from_env_file(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text("DATABASE_URL=postgresql://file:file@localhost:5432/filedb\n")
    settings = Settings(_env_file=env_file)
    assert settings.database_url == "postgresql://file:file@localhost:5432/filedb"


def test_env_var_overrides_env_file(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("DATABASE_URL=postgresql://file:file@localhost:5432/filedb\n")
    monkeypatch.setenv("DATABASE_URL", "postgresql://env:env@localhost:5432/envdb")
    settings = Settings(_env_file=env_file)
    assert settings.database_url == "postgresql://env:env@localhost:5432/envdb"
