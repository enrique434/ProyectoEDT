"""Working calendar of a project (RF-07, RF-08, RN-02, RN-15, RN-16)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, time
from typing import Dict, Iterable, Tuple

from app.domain.errors import ValidationError

WEEKDAYS = range(7)  # 0 = Monday ... 6 = Sunday (datetime.weekday convention)


def _minutes_of(moment: time) -> int:
    return moment.hour * 60 + moment.minute


@dataclass(frozen=True)
class WorkInterval:
    """A continuous block of working time inside a day, e.g. 08:00-12:00."""

    start: time
    end: time

    def __post_init__(self) -> None:
        if _minutes_of(self.end) <= _minutes_of(self.start):
            raise ValidationError(f"Intervalo inválido {self.start:%H:%M}-{self.end:%H:%M}: el fin debe ser posterior al inicio")

    @property
    def minutes(self) -> int:
        return _minutes_of(self.end) - _minutes_of(self.start)

    @property
    def start_minute(self) -> int:
        return _minutes_of(self.start)


def validate_intervals(intervals: Iterable[WorkInterval]) -> Tuple[WorkInterval, ...]:
    """Sorts intervals and rejects overlaps."""
    ordered = tuple(sorted(intervals, key=lambda iv: iv.start_minute))
    for previous, current in zip(ordered, ordered[1:]):
        if current.start_minute < _minutes_of(previous.end):
            raise ValidationError("Los intervalos de trabajo de un día no pueden solaparse")
    return ordered


@dataclass(frozen=True)
class CalendarException:
    """A specific date that overrides the weekly pattern.

    With no intervals it is a holiday / non-working day; with intervals it is a special
    working day (e.g. a working Saturday or a half day).
    """

    day: date
    name: str
    intervals: Tuple[WorkInterval, ...] = ()

    @property
    def is_working(self) -> bool:
        return bool(self.intervals)


def standard_workday() -> Tuple[WorkInterval, ...]:
    return (WorkInterval(time(8, 0), time(12, 0)), WorkInterval(time(13, 0), time(17, 0)))


@dataclass
class WorkCalendar:
    week: Dict[int, Tuple[WorkInterval, ...]] = field(default_factory=dict)
    exceptions: Dict[date, CalendarException] = field(default_factory=dict)

    @classmethod
    def standard(cls) -> "WorkCalendar":
        """Monday-Friday 08:00-12:00 / 13:00-17:00 (8 h), weekend off."""
        week = {day: standard_workday() if day < 5 else () for day in WEEKDAYS}
        return cls(week=week)

    def __post_init__(self) -> None:
        self.week = {day: validate_intervals(self.week.get(day, ())) for day in WEEKDAYS}
        if not any(self.week.values()):
            raise ValidationError("El calendario debe tener al menos un día laborable en la semana")

    def set_week(self, week: Dict[int, Iterable[WorkInterval]]) -> None:
        candidate = WorkCalendar(week={d: tuple(week.get(d, ())) for d in WEEKDAYS})
        self.week = candidate.week

    def set_exceptions(self, exceptions: Iterable[CalendarException]) -> None:
        result: Dict[date, CalendarException] = {}
        for exception in exceptions:
            if exception.day in result:
                raise ValidationError(f"Fecha duplicada en excepciones: {exception.day.isoformat()}")
            validated = CalendarException(exception.day, exception.name.strip() or "Excepción",
                                          validate_intervals(exception.intervals))
            result[exception.day] = validated
        self.exceptions = result

    def intervals_for(self, day: date) -> Tuple[WorkInterval, ...]:
        exception = self.exceptions.get(day)
        if exception is not None:
            return exception.intervals
        return self.week[day.weekday()]

    def working_minutes_on(self, day: date) -> int:
        return sum(iv.minutes for iv in self.intervals_for(day))

    def is_working_day(self, day: date) -> bool:
        return self.working_minutes_on(day) > 0
