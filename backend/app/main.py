"""FastAPI application factory. The ASGI entry point is ``app.asgi:app``."""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.container import Container
from app.api.errors import register_error_handlers
from app.api.routers import projects, team, wbs
from app.config import BACKEND_DIR, Settings, get_settings
from app.infrastructure.persistence.database import run_migrations

FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or get_settings()
    if settings.run_migrations_on_startup:
        run_migrations(settings.database_url)

    app = FastAPI(title="ProyectoEDT API", version="1.0.0",
                  description="Planificación de proyectos tradicionales, ágiles e híbridos: EDT, PERT, CPM y Gantt.")
    app.state.container = Container(settings)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"],
                       allow_headers=["*"])
    register_error_handlers(app)
    for module in (projects, wbs, team):
        app.include_router(module.router)

    @app.get("/api/health", tags=["Sistema"])
    def health() -> dict:
        return {"status": "ok"}

    _serve_frontend(app, FRONTEND_DIST)
    return app


def _serve_frontend(app: FastAPI, dist: Path) -> None:
    """In production the compiled React app is served by the same process (single web server)."""
    if not (dist / "index.html").exists():
        return
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(status_code=404)
        candidate = dist / path
        return FileResponse(candidate if path and candidate.is_file() else dist / "index.html")

