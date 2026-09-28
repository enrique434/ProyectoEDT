"""A node of the WBS (EDT): phase, sprint, story, task, subtask or milestone."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional

from app.domain.errors import ValidationError
from app.domain.value_objects.duration import DurationConverter, TimeUnit
from app.domain.value_objects.enums import (
    ConstraintType,
    EstimationMode,
    ItemStatus,
    Priority,
    WorkItemKind,
)
from app.domain.value_objects.pert import PertEstimate


@dataclass(frozen=True)
class ScheduleConstraint:
    """A manual date that bounds the calculated dates (RN-27)."""

    type: ConstraintType = ConstraintType.ASAP
    day: Optional[date] = None

    def __post_init__(self) -> None:
        if self.type != ConstraintType.ASAP and self.day is None:
            raise ValidationError("La restricción requiere una fecha")
        if self.type == ConstraintType.ASAP and self.day is not None:
            object.__setattr__(self, "day", None)


@dataclass
class ScheduleResult:
    """Calculated values (never typed by the user). Offsets are in working minutes."""

    early_start: int
    early_finish: int
    late_start: int
    late_finish: int
    total_float: int
    free_float: int
    is_critical: bool
    start: datetime
    finish: datetime


@dataclass
class WorkItem:
    id: str
    kind: WorkItemKind
    name: str
    parent_id: Optional[str] = None
    sort_order: int = 0
    description: str = ""
    objective: str = ""  # sprint goal
    duration_minutes: int = 0
    duration_unit: TimeUnit = TimeUnit.DAY
    estimation_mode: EstimationMode = EstimationMode.MANUAL
    pert: Optional[PertEstimate] = None
    constraint: ScheduleConstraint = field(default_factory=ScheduleConstraint)
    status: ItemStatus = ItemStatus.NOT_STARTED
    priority: Priority = Priority.MEDIUM
    progress: int = 0
    schedule: Optional[ScheduleResult] = None

    def __post_init__(self) -> None:
        self.rename(self.name)
        if self.duration_minutes < 0:
            raise ValidationError("La duración no puede ser negativa")  # RN-26
        if self.is_milestone:
            self.duration_minutes = 0  # RN-19
        if not 0 <= self.progress <= 100:
            raise ValidationError("El avance debe estar entre 0 y 100")

    @property
    def is_milestone(self) -> bool:
        return self.kind == WorkItemKind.MILESTONE

    def rename(self, name: str) -> None:
        cleaned = (name or "").strip()
        if not cleaned:
            raise ValidationError("El nombre es obligatorio")
        if len(cleaned) > 200:
            raise ValidationError("El nombre no puede superar 200 caracteres")
        self.name = cleaned

    # ----------------------------------------------------------- estimation
    def set_manual_duration(self, value: float, unit: TimeUnit, converter: DurationConverter) -> None:
        if value < 0:
            raise ValidationError("La duración no puede ser negativa")
        self.estimation_mode = EstimationMode.MANUAL
        self.duration_unit = unit
        self.duration_minutes = 0 if self.is_milestone else converter.to_minutes(value, unit)

    def apply_pert(self, estimate: PertEstimate, unit: TimeUnit, converter: DurationConverter) -> None:
        """TE becomes the planned duration (RN-18)."""
        if self.is_milestone:
            raise ValidationError("Un hito tiene duración cero; no admite PERT")
        self.estimation_mode = EstimationMode.PERT
        self.pert = estimate
        self.duration_unit = unit
        self.duration_minutes = converter.to_minutes(estimate.expected, unit)

    def pert_variance_minutes(self, converter: DurationConverter) -> float:
        if self.estimation_mode != EstimationMode.PERT or self.pert is None:
            return 0.0
        return (self.pert.standard_deviation * converter.minutes_per_unit(self.duration_unit)) ** 2

    # ------------------------------------------------------------- tracking
    def set_progress(self, progress: int) -> None:
        if not 0 <= progress <= 100:
            raise ValidationError("El avance debe estar entre 0 y 100")  # RN-20
        self.progress = progress
        if progress == 100:
            self.status = ItemStatus.COMPLETED  # RN-21
        elif self.status == ItemStatus.COMPLETED:
            self.status = ItemStatus.IN_PROGRESS
        elif progress > 0 and self.status == ItemStatus.NOT_STARTED:
            self.status = ItemStatus.IN_PROGRESS

    def set_status(self, status: ItemStatus) -> None:
        self.status = status
        if status == ItemStatus.COMPLETED:
            self.progress = 100  # RN-21
        elif status == ItemStatus.NOT_STARTED:
            self.progress = 0
        elif self.progress == 100:
            self.progress = 99

    def set_constraint(self, constraint: ScheduleConstraint) -> None:
        self.constraint = constraint

    @property
    def scheduled_minutes(self) -> int:
        """Duration used by the scheduler; cancelled work does not consume time."""
        return 0 if self.status == ItemStatus.CANCELLED else self.duration_minutes
