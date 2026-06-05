from fastapi.testclient import TestClient

from app.main import app


def test_health_exposes_data_path() -> None:
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["data_path"]


def test_default_fund_codes_use_seed_file() -> None:
    response = TestClient(app).get("/api/funds/codes?limit=3")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["codes"] == ["006327", "006328", "040046"]
    assert payload["total_count"] == 5
    assert payload["has_more"] is True
