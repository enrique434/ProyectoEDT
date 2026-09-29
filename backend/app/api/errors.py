"""Maps every failure to one JSON shape the UI can rely on.

    {"code": str, "message": str, "errors"?: [{"field", "label", "message"}], ...extra}

Domain errors already carry Spanish, business-level messages. Request validation errors
(Pydantic) are translated here so the user never sees framework messages in English.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.domain.errors import CycleError, DependencyConflictError, DomainError, NotFoundError

logger = logging.getLogger("proyecto_edt")

FIELD_LABELS: Dict[str, str] = {
    "name": "Nombre",
    "description": "Descripción",
    "methodology": "Metodología",
    "start_date": "Fecha de inicio",
    "target_date": "Fecha objetivo",
    "hours_per_day": "Horas por día",
    "days_per_week": "Días por semana",
    "days_per_month": "Días por mes",
    "default_time_unit": "Unidad temporal",
    "default_task_duration": "Duración predeterminada de tarea",
    "default_sprint_duration": "Duración predeterminada de sprint",
    "value": "Valor",
    "unit": "Unidad",
    "kind": "Tipo",
    "parent_id": "Contenedor",
    "duration_value": "Duración",
    "duration_unit": "Unidad de duración",
    "optimistic": "Optimista (O)",
    "most_likely": "Más probable (M)",
    "pessimistic": "Pesimista (P)",
    "constraint_type": "Restricción",
    "constraint_date": "Fecha de restricción",
    "status": "Estado",
    "priority": "Prioridad",
    "progress": "Avance",
    "predecessor_id": "Predecesora",
    "successor_id": "Sucesora",
    "type": "Tipo de dependencia",
    "lag_value": "Lag / Lead",
    "lag_unit": "Unidad de lag",
    "role_id": "Rol",
    "email": "Correo",
    "responsibility": "Responsabilidad",
    "active": "Activo",
    "member_id": "Integrante",
    "units": "Dedicación",
    "weekday": "Día de la semana",
    "day": "Fecha",
    "start": "Hora de inicio",
    "end": "Hora de fin",
    "position": "Posición",
    "strategy": "Estrategia",
}


def _number(value: Any) -> Any:
    return int(value) if isinstance(value, float) and value.is_integer() else value


def _translate(error: Dict[str, Any]) -> str:
    kind = error.get("type", "")
    ctx = {key: _number(value) for key, value in (error.get("ctx") or {}).items()}
    messages = {
        "missing": "Es obligatorio.",
        "string_too_short": "No puede estar vacío.",
        "string_too_long": f"Admite como máximo {ctx.get('max_length')} caracteres.",
        "greater_than_equal": f"Debe ser mayor o igual a {ctx.get('ge')}.",
        "greater_than": f"Debe ser mayor que {ctx.get('gt')}.",
        "less_than_equal": f"Debe ser menor o igual a {ctx.get('le')}.",
        "less_than": f"Debe ser menor que {ctx.get('lt')}.",
        "int_parsing": "Debe ser un número entero.",
        "int_from_float": "Debe ser un número entero.",
        "float_parsing": "Debe ser un número.",
        "bool_parsing": "Debe ser verdadero o falso.",
        "date_parsing": "No es una fecha válida.",
        "date_from_datetime_parsing": "No es una fecha válida.",
        "time_parsing": "No es una hora válida.",
        "enum": "Valor no permitido.",
        "literal_error": "Valor no permitido.",
        "string_type": "Debe ser texto.",
        "json_invalid": "La solicitud no tiene un formato válido.",
    }
    return messages.get(kind, "Valor no válido.")


def _field_errors(exc: RequestValidationError) -> List[Dict[str, str]]:
    result = []
    for error in exc.errors():
        path = [str(part) for part in error.get("loc", ()) if part not in ("body", "query", "path")]
        field = next((p for p in reversed(path) if not p.isdigit()), "")
        result.append({"field": ".".join(path), "label": FIELD_LABELS.get(field, field or "Solicitud"),
                       "message": _translate(error)})
    return result


def _response(status: int, code: str, message: str, **extra: Any) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "message": message, **extra})


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = _field_errors(exc)
        return _response(422, "invalid_request", "Algunos datos no son válidos. Revise los campos indicados.",
                         errors=errors)

    @app.exception_handler(NotFoundError)
    async def not_found(_: Request, error: NotFoundError) -> JSONResponse:
        return _response(404, error.code, error.message, entity=error.entity)

    @app.exception_handler(CycleError)
    async def cycle(_: Request, error: CycleError) -> JSONResponse:
        return _response(409, error.code, error.message, cycle=error.cycle)

    @app.exception_handler(DependencyConflictError)
    async def conflict(_: Request, error: DependencyConflictError) -> JSONResponse:
        return _response(409, error.code, error.message, dependencies=[d.__dict__ for d in error.dependencies])

    @app.exception_handler(DomainError)
    async def domain(_: Request, error: DomainError) -> JSONResponse:
        return _response(422, error.code, error.message)

    @app.exception_handler(Exception)
    async def unexpected(request: Request, _error: Exception) -> JSONResponse:
        logger.exception("Error no controlado en %s %s", request.method, request.url.path)
        return _response(500, "internal_error",
                         "Ocurrió un error inesperado en el servidor. Los cambios no se guardaron; inténtelo de nuevo.")
