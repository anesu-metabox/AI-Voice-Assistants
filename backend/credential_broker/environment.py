"""Load only broker-owned local secrets into the credential-broker process."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import dotenv_values


BROKER_ONLY_ENV_KEYS = frozenset({
    "GOOGLE_CLIENT_SECRET",
    "CREDENTIAL_ENCRYPTION_KEY",
    "CREDENTIAL_ENCRYPTION_KEY_VERSION",
    "CREDENTIAL_ENCRYPTION_PREVIOUS_KEY",
    "CREDENTIAL_ENCRYPTION_PREVIOUS_KEY_VERSION",
})
PROTECTED_BRANCH_NAMES = frozenset({"production", "main", "primary"})


def load_broker_environment(env_file: Path | None = None) -> None:
    """Load broker secrets from local dotenv only for an isolated dev branch.

    Production deployments must inject broker secrets into this process from
    the deployment secret manager. In development, a dedicated broker dotenv
    file takes precedence over the root dotenv file. Only the explicit broker
    allowlist is copied into ``os.environ``; general API credentials such as
    ``DATABASE_URL_UNPOOLED`` and ``RUNTIME_DB_PASSWORD`` are never imported.
    """
    repo_root = Path(__file__).resolve().parents[2]
    sources = [env_file] if env_file is not None else [
        repo_root / "backend" / "credential_broker" / ".env",
        repo_root / ".env",
    ]

    values: dict[str, str] = {}
    for source in sources:
        if source is not None and source.is_file():
            values.update({key: value for key, value in dotenv_values(source).items() if value is not None})

    app_env = os.getenv("APP_ENV", values.get("APP_ENV", "")).strip().lower()
    branch = os.getenv("NEON_BRANCH", values.get("NEON_BRANCH", "")).strip().lower()
    protected_target = app_env in {"prod", "production"} or branch in PROTECTED_BRANCH_NAMES
    if protected_target:
        if app_env not in {"prod", "production"}:
            os.environ.setdefault("APP_ENV", "production")
        return
    if not branch:
        # Do not source secrets from a dotenv file until the caller identifies
        # an explicit non-production branch.
        return

    for key in BROKER_ONLY_ENV_KEYS:
        if not os.getenv(key) and values.get(key):
            os.environ[key] = values[key]
