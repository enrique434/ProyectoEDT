"""End-to-end API tests: the full MVP cycle of section 5, against a temporary SQLite file."""
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def db_url(tmp_path):
    return f"sqlite:///{(tmp_path / 'test.db').as_posix()}"


@pytest.fixture
def client(db_url):
    with TestClient(create_app(Settings(database_url=db_url))) as c:
        yield c


def by_name(project, name):
    return next(i for i in project["items"] if i["name"] == name)


def test_full_planning_cycle_and_recovery(client, db_url):
    # Crear proyecto + elegir metodología
    r = client.post("/api/projects", json={"name": "Sistema", "methodology": "hybrid", "start_date": "2026-09-07",
                                           "target_date": "2026-12-31"})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    assert r.json()["allowed_children"]["phase"] == ["milestone", "sprint", "task"]

    # Configurar calendario: feriado el martes 8
    week = [{"weekday": d, "intervals": [{"start": "08:00", "end": "12:00"}, {"start": "13:00", "end": "17:00"}]
             if d < 5 else []} for d in range(7)]
    r = client.put(f"/api/projects/{pid}/calendar",
                   json={"week": week, "exceptions": [{"day": "2026-09-08", "name": "Feriado"}]})
    assert r.status_code == 200 and r.json()["calendar"]["exceptions"][0]["is_working"] is False

    # Personas y roles
    role_id = client.post(f"/api/projects/{pid}/roles", json={"name": "QA Lead"}).json()["id"]
    member_id = client.post(f"/api/projects/{pid}/members",
                            json={"name": "Ana", "role_id": role_id, "hours_per_day": 6}).json()["id"]

    # Estructura: fase -> sprint -> tareas
    phase = client.post(f"/api/projects/{pid}/items", json={"kind": "phase", "name": "Desarrollo"}).json()["id"]
    sprint = client.post(f"/api/projects/{pid}/items",
                         json={"kind": "sprint", "name": "Sprint 1", "parent_id": phase}).json()["id"]
    a = client.post(f"/api/projects/{pid}/items", json={"kind": "task", "name": "A", "parent_id": sprint,
                                                         "duration_value": 2, "duration_unit": "day"}).json()["id"]
    r = client.post(f"/api/projects/{pid}/items", json={"kind": "task", "name": "B", "parent_id": sprint})
    b = r.json()["id"]
    assert by_name(r.json()["project"], "B")["wbs_code"] == "1.1.2"

    # Estructura inválida
    r = client.post(f"/api/projects/{pid}/items", json={"kind": "sprint", "name": "X"})
    assert r.status_code == 422 and r.json()["code"] == "hierarchy_rule"

    # PERT + responsables
    r = client.put(f"/api/projects/{pid}/items/{b}",
                   json={"estimation_mode": "pert", "pert": {"optimistic": 1, "most_likely": 2, "pessimistic": 3}})
    assert by_name(r.json(), "B")["pert"]["expected"] == 2
    r = client.put(f"/api/projects/{pid}/items/{b}/assignments", json={"assignments": [{"member_id": member_id}]})
    assert by_name(r.json(), "B")["assignments"] == [{"member_id": member_id, "units": 100}]
    r = client.put(f"/api/projects/{pid}/items/{b}",
                   json={"estimation_mode": "pert", "pert": {"optimistic": 5, "most_likely": 2, "pessimistic": 3}})
    assert r.status_code == 422

    # Dependencias + ciclo
    r = client.post(f"/api/projects/{pid}/dependencies", json={"predecessor_id": a, "successor_id": b,
                                                                "type": "FS", "lag_value": 1, "lag_unit": "day"})
    assert r.status_code == 201
    r = client.post(f"/api/projects/{pid}/dependencies", json={"predecessor_id": b, "successor_id": a})
    assert r.status_code == 409 and r.json()["code"] == "dependency_cycle"

    # Planificación: A lun 7 + mié 9 (martes feriado), lag 1d (jue 10), B vie 11 + lun 14
    project = client.get(f"/api/projects/{pid}").json()
    item_a, item_b = by_name(project, "A"), by_name(project, "B")
    assert item_a["schedule"]["finish"] == "2026-09-09T17:00:00"
    assert item_b["schedule"]["start"] == "2026-09-11T08:00:00"
    # The 2-week sprint timebox drives the finish: the sprint is critical, its tasks have float.
    assert by_name(project, "Sprint 1")["schedule"]["is_critical"]
    assert item_b["schedule"]["total_float"] > 0
    assert project["schedule"]["finish"] == "2026-09-21T17:00:00"  # 10 working days, holiday skipped

    # Eliminar con dependencias exige estrategia (RN-28)
    r = client.delete(f"/api/projects/{pid}/items/{a}")
    assert r.status_code == 409 and len(r.json()["dependencies"]) == 1

    # Avance
    r = client.put(f"/api/projects/{pid}/items/{a}", json={"progress": 100})
    assert by_name(r.json(), "A")["status"] == "completed"

    # Cerrar y volver a abrir: una nueva instancia de la aplicación sobre la misma base de datos
    with TestClient(create_app(Settings(database_url=db_url))) as reopened:
        again = reopened.get(f"/api/projects/{pid}").json()
    assert again["items"] == client.get(f"/api/projects/{pid}").json()["items"]
    assert len(again["dependencies"]) == 1 and again["members"][0]["name"] == "Ana"
    assert again["calendar"]["exceptions"][0]["day"] == "2026-09-08"


def test_projects_are_independent_and_listed(client):
    first = client.post("/api/projects/samples", json={"methodology": "traditional", "start_date": "2026-09-07"})
    second = client.post("/api/projects/samples", json={"methodology": "agile", "start_date": "2026-09-07"})
    assert first.status_code == second.status_code == 201
    listing = client.get("/api/projects").json()
    assert {p["id"] for p in listing} == {first.json()["id"], second.json()["id"]}
    assert all(p["item_count"] > 0 for p in listing)

    client.delete(f"/api/projects/{first.json()['id']}")
    assert [p["id"] for p in client.get("/api/projects").json()] == [second.json()["id"]]
    assert client.get(f"/api/projects/{first.json()['id']}").status_code == 404


@pytest.mark.parametrize("methodology", ["traditional", "agile", "hybrid"])
def test_samples_are_fully_scheduled(client, methodology):
    project = client.post("/api/projects/samples", json={"methodology": methodology,
                                                         "start_date": "2026-09-07"}).json()
    assert project["schedule"]["critical_item_ids"]
    assert all(item["schedule"] is not None for item in project["items"])
    loads = client.get(f"/api/projects/{project['id']}/resource-load").json()
    assert len(loads) == len(project["members"])


def test_delete_summary_with_bridge_and_move(client):
    pid = client.post("/api/projects/samples", json={"methodology": "hybrid", "start_date": "2026-09-07"}).json()["id"]
    project = client.get(f"/api/projects/{pid}").json()
    sprint2 = by_name(project, "Sprint 2")["id"]
    r = client.delete(f"/api/projects/{pid}/items/{sprint2}", params={"strategy": "bridge"})
    assert r.status_code == 200, r.text
    names = {i["name"] for i in r.json()["items"]}
    assert "Sprint 2" not in names and "Productos" not in names

    tests_phase = by_name(r.json(), "Pruebas")["id"]
    login = by_name(r.json(), "Login")["id"]
    r = client.post(f"/api/projects/{pid}/items/{login}/move", json={"parent_id": tests_phase, "position": 0})
    assert r.status_code == 200 and by_name(r.json(), "Login")["parent_id"] == tests_phase


def test_update_settings_and_methodology_validation(client):
    project = client.post("/api/projects/samples", json={"methodology": "hybrid", "start_date": "2026-09-07"}).json()
    body = {"name": project["name"], "description": "", "methodology": "traditional",
            "start_date": "2026-09-07", "target_date": None, "settings": project["settings"]}
    r = client.put(f"/api/projects/{project['id']}", json=body)
    assert r.status_code == 422  # sprints are not allowed in a traditional project

    body["methodology"] = "hybrid"
    body["settings"] = {**project["settings"], "hours_per_day": 6}
    r = client.put(f"/api/projects/{project['id']}", json=body)
    assert r.status_code == 200
    assert r.json()["settings"]["minutes_per_day"] == 360
    assert by_name(r.json(), "Validación")["duration_value"] == 2  # still 2 days
