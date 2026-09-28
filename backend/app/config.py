"""Application settings, read from environment variables or ``backend/.env``."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    # Any SQLAlchemy URL works, e.g. postgresql+psycopg://user:pass@host/db
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'data' / 'proyecto_edt.db').as_posix()}"
    cors_origins: List[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    run_migrations_on_startup: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
