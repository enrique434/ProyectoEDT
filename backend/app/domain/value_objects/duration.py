"""Time units and the conversion to the internal unit: working minutes (RNF-12)."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from app.domain.errors import ValidationError

MINUTES_PER_HOUR = 60


class TimeUnit(str, Enum):
    HOUR = "hour"
    DAY = "day"
    WEEK = "week"
    MONTH = "month"


@dataclass(frozen=True)
class DurationConverter:
    """Converts user-facing durations to working minutes using project-level parameters.

    A month is not "30 days": it is ``days_per_month`` *working* days, configurable per project.
    """

    minutes_per_day: int = 480
    days_per_week: int = 5
    days_per_month: int = 20

    def __post_init__(self) -> None:
        if not 1 <= self.minutes_per_day <= 24 * MINUTES_PER_HOUR:
            raise ValidationError("Los minutos por día deben estar entre 1 y 1440")
        if not 1 <= self.days_per_week <= 7:
            raise ValidationError("Los días por semana deben estar entre 1 y 7")
        if not 1 <= self.days_per_month <= 31:
            raise ValidationError("Los días por mes deben estar entre 1 y 31")

    def minutes_per_unit(self, unit: TimeUnit) -> int:
        factors = {
            TimeUnit.HOUR: MINUTES_PER_HOUR,
            TimeUnit.DAY: self.minutes_per_day,
            TimeUnit.WEEK: self.minutes_per_day * self.days_per_week,
            TimeUnit.MONTH: self.minutes_per_day * self.days_per_month,
        }
        return factors[unit]

    def to_minutes(self, value: float, unit: TimeUnit) -> int:
        return round(value * self.minutes_per_unit(unit))

    def from_minutes(self, minutes: int, unit: TimeUnit) -> float:
        return minutes / self.minutes_per_unit(unit)
