"""The legacy-data cleanup must clear exact demo values without deleting tenants."""

from pathlib import Path


def test_migration_only_clears_exact_historical_sample_values():
    migration = (
        Path(__file__).resolve().parents[2]
        / "db"
        / "migrations"
        / "020_clear_legacy_demo_profile_values.sql"
    )
    sql = migration.read_text(encoding="utf-8")

    expected_values = (
        "Acme Operations Inc.",
        "https://acmeops.com",
        "+1 (555) 019-2834",
        "support@acmeops.com",
        "America/New_York (EST)",
        "Support Agent – Charlie",
        "This is Ava",
        "Acme guidelines",
        "Standard return window is 30 days",
    )
    for value in expected_values:
        assert value in sql

    assert sql.count("UPDATE ") == 2
    assert "DELETE FROM" not in sql.upper()
    assert "DROP " not in sql.upper()
    assert "WHERE company_name = 'Acme Operations Inc.'" in sql
    assert "WHERE assistant_name = 'Support Agent – Charlie'" in sql
    assert "THEN 'Indian/Mauritius'" in sql


def test_historical_demo_seed_migration_is_not_rewritten():
    migrations = Path(__file__).resolve().parents[2] / "db" / "migrations"
    original = (migrations / "005_company_and_assistant_config.sql").read_text(encoding="utf-8")
    cleanup = (migrations / "020_clear_legacy_demo_profile_values.sql").read_text(encoding="utf-8")

    assert "DEFAULT 'Acme Operations Inc.'" in original
    assert "exact fictional values seeded by migration 005" in cleanup


def test_application_runtime_sources_do_not_contain_known_fictional_profile_values():
    repository = Path(__file__).resolve().parents[2]
    runtime_roots = (
        repository / "backend" / "app",
        repository / "backend" / "credential_broker",
        repository / "agent",
        repository / "frontend" / "src",
    )
    forbidden = (
        "Acme Operations Inc.",
        "https://acmeops.com",
        "+1 (555) 019-2834",
        "support@acmeops.com",
        "Support Agent – Charlie",
        "This is Ava",
        "Acme guidelines",
        "Standard return window is 30 days",
    )
    source_suffixes = {".py", ".ts", ".tsx", ".js", ".mjs", ".json", ".css"}

    violations = []
    for source_root in runtime_roots:
        for source in source_root.rglob("*"):
            if source.is_file() and source.suffix in source_suffixes and "tests" not in source.parts:
                content = source.read_text(encoding="utf-8")
                for value in forbidden:
                    if value in content:
                        violations.append(f"{source.relative_to(repository)} contains {value!r}")

    assert violations == []
