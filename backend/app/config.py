"""
Backend Configuration Settings
Loads typed environment settings from .env file.
"""

from pathlib import Path
from typing import List
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Multi-path .env resolution (repo root, backend dir, CWD)
_repo_root = Path(__file__).resolve().parents[2]
_backend_dir = Path(__file__).resolve().parents[1]
_env_files = [
    str(_repo_root / ".env"),
    str(_backend_dir / ".env"),
    ".env",
]


class Settings(BaseSettings):
    # Server settings
    backend_host: str = Field(default="127.0.0.1", validation_alias="BACKEND_HOST")
    backend_port: int = Field(default=8000, validation_alias="BACKEND_PORT")
    backend_url: str = Field(default="http://127.0.0.1:8000", validation_alias="BACKEND_URL")
    cors_origins: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000",
        validation_alias="CORS_ORIGINS",
    )

    # Database (Neon PostgreSQL)
    database_url: str = Field(default="", validation_alias="DATABASE_URL")
    database_url_unpooled: str = Field(default="", validation_alias="DATABASE_URL_UNPOOLED")

    # External APIs
    google_client_id: str = Field(default="", validation_alias="GOOGLE_CLIENT_ID")
    google_client_secret: str = Field(default="", validation_alias="GOOGLE_CLIENT_SECRET")
    google_redirect_uri: str = Field(
        default="http://localhost:8000/auth/google/callback",
        validation_alias="GOOGLE_REDIRECT_URI",
    )
    trigger_api_key: str = Field(default="", validation_alias="TRIGGER_API_KEY")

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    model_config = SettingsConfigDict(
        env_file=_env_files,
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
