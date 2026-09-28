"""Precedence relation between two activities (PDM / AON)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Collection

from app.domain.errors import ValidationError
from app.domain.value_objects.duration import TimeUnit
from app.domain.value_objects.enums import DependencyType


@dataclass
class Dependency:
    """``lag_minutes`` > 0 is a lag (delay); < 0 is a lead (overlap) (RN-14)."""

    id: str
    predecessor_id: str
    successor_id: str
    type: DependencyType = DependencyType.FS
    lag_minutes: int = 0
    lag_unit: TimeUnit = TimeUnit.DAY

    def __post_init__(self) -> None:
        if self.predecessor_id == self.successor_id:
            raise ValidationError("Una actividad no puede depender de sí misma")  # RN-11

    def involves(self, item_id: str) -> bool:
        return item_id in (self.predecessor_id, self.successor_id)

    def involves_any(self, item_ids: Collection[str]) -> bool:
        return self.predecessor_id in item_ids or self.successor_id in item_ids
