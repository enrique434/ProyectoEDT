"""Maps domain exceptions to HTTP responses with a stable JSON shape: {code, message, ...}."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.domain.errors import CycleError, DependencyConflictError, DomainError, NotFoundError


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(NotFoundError)
    async def not_found(_: Request, error: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"code": error.code, "message": error.message})

    @app.exception_handler(CycleError)
    async def cycle(_: Request, error: CycleError) -> JSONResponse:
        return JSONResponse(status_code=409,
                            content={"code": error.code, "message": error.message, "cycle": error.cycle})

    @app.exception_handler(DependencyConflictError)
    async def conflict(_: Request, error: DependencyConflictError) -> JSONResponse:
        return JSONResponse(status_code=409, content={
            "code": error.code, "message": error.message,
            "dependencies": [d.__dict__ for d in error.dependencies]})

    @app.exception_handler(DomainError)
    async def domain(_: Request, error: DomainError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"code": error.code, "message": error.message})
