"""People working on the project: roles, members and assignments (RF-09, RF-10, RF-11, RF-16)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.domain.errors import ValidationError


def _required_name(value: str, label: str) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        raise ValidationError(f"El nombre del {label} es obligatorio")
    if len(cleaned) > 120:
        raise ValidationError(f"El nombre del {label} no puede superar 120 caracteres")
    return cleaned


@dataclass
class Role:
    id: str
    name: str
    description: str = ""

    def __post_init__(self) -> None:
        self.name = _required_name(self.name, "rol")


@dataclass
class Member:
    id: str
    name: str
    role_id: Optional[str] = None
    email: str = ""
    responsibility: str = ""
    hours_per_day: float = 8.0
    active: bool = True

    def __post_init__(self) -> None:
        self.name = _required_name(self.name, "integrante")
        if not 0 < self.hours_per_day <= 24:
            raise ValidationError("Las horas disponibles por día deben estar entre 0 y 24")


@dataclass
class Assignment:
    """``units`` is the allocation percentage of the member on the activity (100 = full time)."""

    id: str
    work_item_id: str
    member_id: str
    units: int = 100

    def __post_init__(self) -> None:
        if not 1 <= self.units <= 100:
            raise ValidationError("La dedicación debe estar entre 1% y 100%")
