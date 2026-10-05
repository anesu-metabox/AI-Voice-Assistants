import importlib


def test_gemini_live_defaults_to_v1beta(monkeypatch):
    monkeypatch.delenv("GEMINI_API_VERSION", raising=False)

    import agent.config as config

    config = importlib.reload(config)
    assert config.GEMINI_API_VERSION == "v1beta"


def test_gemini_recovery_is_enabled_by_default(monkeypatch):
    monkeypatch.delenv("GEMINI_RECOVERY_ENABLED", raising=False)

    import agent.config as config

    config = importlib.reload(config)
    assert config.GEMINI_RECOVERY_ENABLED is True


def test_gemini_recovery_can_be_disabled(monkeypatch):
    monkeypatch.setenv("GEMINI_RECOVERY_ENABLED", "false")

    import agent.config as config

    config = importlib.reload(config)
    assert config.GEMINI_RECOVERY_ENABLED is False


def test_gemini_model_defaults_to_flash_exp(monkeypatch):
    monkeypatch.delenv("GEMINI_MODEL", raising=False)

    import agent.config as config

    config = importlib.reload(config)
    assert config.GEMINI_MODEL == "gemini-2.0-flash-exp"
