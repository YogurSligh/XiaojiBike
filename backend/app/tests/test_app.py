from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import app


def test_health_does_not_expose_local_paths() -> None:
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload == {"status": "ok"}


def test_default_fund_codes_use_seed_file() -> None:
    response = TestClient(app).get("/api/funds/codes?limit=3")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["codes"] == ["006327", "006328", "040046"]
    assert payload["total_count"] == 5
    assert payload["has_more"] is True


def test_settings_accept_new_env_prefix(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("XUANJIBAO_APP_DATA_DIR", raising=False)
    monkeypatch.setenv("XIAOJIBIKE_APP_DATA_DIR", str(tmp_path / "new-data"))

    assert Settings().data_dir == tmp_path / "new-data"


def test_settings_accept_legacy_env_prefix(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("XIAOJIBIKE_APP_DATA_DIR", raising=False)
    monkeypatch.setenv("XUANJIBAO_APP_DATA_DIR", str(tmp_path / "legacy-data"))

    assert Settings().data_dir == tmp_path / "legacy-data"
