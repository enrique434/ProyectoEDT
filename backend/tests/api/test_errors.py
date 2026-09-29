"""Every error reaches the UI with the same shape and in Spanish."""
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Settings(database_url=f"sqlite:///{(tmp_path / 'e.db').as_posix()}"))) as c:
        yield c


def test_request_validation_errors_are_translated_per_field(client):
    r = client.post("/api/projects", json={"name": "", "methodology": "waterfall", "start_date": "31/12/2026"})
    body = r.json()
    assert r.status_code == 422 and body["code"] == "invalid_request"
    assert body["message"].startswith("Algunos datos no son válidos")
    by_field = {e["field"]: e for e in body["errors"]}
    assert by_field["name"] == {"field": "name", "label": "Nombre", "message": "No puede estar vacío."}
    assert by_field["methodology"]["message"] == "Valor no permitido."
    assert by_field["start_date"]["label"] == "Fecha de inicio"


def test_nested_fields_keep_their_path(client):
    r = client.post("/api/projects", json={"name": "P", "methodology": "agile", "start_date": "2026-09-07",
                                           "settings": {"hours_per_day": 30}})
    error = r.json()["errors"][0]
    assert error["field"] == "settings.hours_per_day"
    assert error["label"] == "Horas por día" and error["message"] == "Debe ser menor o igual a 24."


def test_not_found_does_not_expose_internal_ids(client):
    r = client.get("/api/projects/abc-123")
    assert r.status_code == 404
    assert "abc-123" not in r.json()["message"] and r.json()["entity"] == "Proyecto"


def test_unexpected_errors_return_a_friendly_500(tmp_path, monkeypatch):
    from app.api import presenters

    def boom():
        raise RuntimeError("detalle interno")

    monkeypatch.setattr(presenters, "methodologies_out", boom)
    app = create_app(Settings(database_url=f"sqlite:///{(tmp_path / 'x.db').as_posix()}"))
    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.get("/api/methodologies")
    assert r.status_code == 500 and r.json()["code"] == "internal_error"
    assert "detalle interno" not in r.json()["message"]
