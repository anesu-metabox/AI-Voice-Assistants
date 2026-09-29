import importlib


def test_gemini_live_defaults_to_v1beta(monkeypatch):
    monkeypatch.delenv("GEMINI_API_VERSION", raising=False)

    import agent.config as config

    config = importlib.reload(config)
    assert config.GEMINI_API_VERSION == "v1beta"
