"""HTTP contracts (Pydantic). They validate shape; business rules live in the domain."""
from __future__ import annotations

from datetime import date, datetime, time
from typing import Dict, List, Optional

from pydantic import BaseModel, Field

from app.domain.value_objects.duration import TimeUnit
from app.domain.value_objects.enums import (
    ConstraintType,
    DependencyType,
    EstimationMode,
    ItemStatus,
    Methodology,
    Priority,
    WorkItemKind,
)


# =================================================================== requests
class DurationIn(BaseModel):
    value: float = Field(ge=0)
    unit: TimeUnit


class SettingsIn(BaseModel):
    default_time_unit: TimeUnit = TimeUnit.DAY
    default_task_duration: DurationIn = DurationIn(value=1, unit=TimeUnit.DAY)
    default_sprint_duration: DurationIn = DurationIn(value=2, unit=TimeUnit.WEEK)
    hours_per_day: float = Field(8, gt=0, le=24)
    days_per_week: int = Field(5, ge=1, le=7)
    days_per_month: int = Field(20, ge=1, le=31)


class ProjectCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    description: str = ""
    methodology: Methodology
    start_date: date
    target_date: Optional[date] = None
    settings: Optional[SettingsIn] = None


class ProjectUpdateIn(ProjectCreateIn):
    settings: SettingsIn


class SampleIn(BaseModel):
    methodology: Methodology
    start_date: Optional[date] = None


class IntervalIn(BaseModel):
    start: time
    end: time


class WeekDayIn(BaseModel):
    weekday: int = Field(ge=0, le=6)
    intervals: List[IntervalIn] = []


class CalendarExceptionIn(BaseModel):
    day: date
    name: str = Field(min_length=1, max_length=120)
    intervals: List[IntervalIn] = []


class CalendarIn(BaseModel):
    week: List[WeekDayIn]
    exceptions: List[CalendarExceptionIn] = []


class RoleIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""


class MemberIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role_id: Optional[str] = None
    email: str = ""
    responsibility: str = ""
    hours_per_day: float = Field(8, gt=0, le=24)
    active: bool = True


class ItemCreateIn(BaseModel):
    kind: WorkItemKind
    name: str = Field(min_length=1, max_length=200)
    parent_id: Optional[str] = None
    description: str = ""
    objective: str = ""
    duration_value: Optional[float] = Field(None, ge=0)
    duration_unit: Optional[TimeUnit] = None


class PertIn(BaseModel):
    optimistic: float = Field(ge=0)
    most_likely: float = Field(ge=0)
    pessimistic: float = Field(ge=0)


class ItemUpdateIn(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    objective: Optional[str] = None
    kind: Optional[WorkItemKind] = None
    estimation_mode: Optional[EstimationMode] = None
    duration_value: Optional[float] = Field(None, ge=0)
    duration_unit: Optional[TimeUnit] = None
    pert: Optional[PertIn] = None
    constraint_type: Optional[ConstraintType] = None
    constraint_date: Optional[date] = None
    status: Optional[ItemStatus] = None
    priority: Optional[Priority] = None
    progress: Optional[int] = Field(None, ge=0, le=100)


class MoveIn(BaseModel):
    parent_id: Optional[str] = None
    position: Optional[int] = Field(None, ge=0)


class AllocationIn(BaseModel):
    member_id: str
    units: int = Field(100, ge=1, le=100)


class AssignmentsIn(BaseModel):
    assignments: List[AllocationIn]


class DependencyCreateIn(BaseModel):
    predecessor_id: str
    successor_id: str
    type: DependencyType = DependencyType.FS
    lag_value: float = 0
    lag_unit: TimeUnit = TimeUnit.DAY


class DependencyUpdateIn(BaseModel):
    type: DependencyType
    lag_value: float = 0
    lag_unit: TimeUnit = TimeUnit.DAY


# ================================================================== responses
class ProjectListItemOut(BaseModel):
    id: str
    name: str
    description: str
    methodology: Methodology
    start_date: date
    target_date: Optional[date]
    finish: Optional[datetime]
    item_count: int
    updated_at: datetime


class SettingsOut(SettingsIn):
    minutes_per_day: int


class IntervalOut(BaseModel):
    start: str
    end: str


class CalendarOut(BaseModel):
    week: Dict[int, List[IntervalOut]]
    exceptions: List["CalendarExceptionOut"]


class CalendarExceptionOut(BaseModel):
    day: date
    name: str
    is_working: bool
    intervals: List[IntervalOut]


class RoleOut(BaseModel):
    id: str
    name: str
    description: str


class MemberOut(BaseModel):
    id: str
    name: str
    role_id: Optional[str]
    email: str
    responsibility: str
    hours_per_day: float
    active: bool


class PertOut(BaseModel):
    optimistic: float
    most_likely: float
    pessimistic: float
    expected: float
    std_dev: float


class ItemScheduleOut(BaseModel):
    start: datetime
    finish: datetime
    early_start: int
    early_finish: int
    late_start: int
    late_finish: int
    total_float: int
    free_float: int
    is_critical: bool


class AllocationOut(BaseModel):
    member_id: str
    units: int


class ItemOut(BaseModel):
    id: str
    parent_id: Optional[str]
    row: int
    wbs_code: str
    level: int
    kind: WorkItemKind
    name: str
    description: str
    objective: str
    is_summary: bool
    duration_minutes: int
    duration_value: float
    duration_unit: TimeUnit
    estimation_mode: EstimationMode
    pert: Optional[PertOut]
    constraint_type: ConstraintType
    constraint_date: Optional[date]
    status: ItemStatus
    priority: Priority
    progress: int
    assignments: List[AllocationOut]
    schedule: Optional[ItemScheduleOut]


class DependencyOut(BaseModel):
    id: str
    predecessor_id: str
    successor_id: str
    type: DependencyType
    lag_minutes: int
    lag_value: float
    lag_unit: TimeUnit


class ScheduleOut(BaseModel):
    start: datetime
    finish: datetime
    duration_minutes: int
    duration_days: float
    critical_item_ids: List[str]
    pert_std_dev_minutes: float
    target_probability: Optional[float]
    warnings: List[str]
    calculated_at: datetime


class ProjectOut(BaseModel):
    id: str
    name: str
    description: str
    methodology: Methodology
    start_date: date
    target_date: Optional[date]
    settings: SettingsOut
    calendar: CalendarOut
    allowed_children: Dict[str, List[WorkItemKind]]
    roles: List[RoleOut]
    members: List[MemberOut]
    items: List[ItemOut]
    dependencies: List[DependencyOut]
    schedule: Optional[ScheduleOut]
    created_at: datetime
    updated_at: datetime


class CreatedOut(BaseModel):
    id: str
    project: ProjectOut


class DailyLoadOut(BaseModel):
    day: date
    minutes: int
    overallocated: bool


class MemberLoadOut(BaseModel):
    member_id: str
    name: str
    active: bool
    capacity_minutes_per_day: int
    total_minutes: int
    overallocated_days: int
    days: List[DailyLoadOut]


class MethodologyOut(BaseModel):
    value: Methodology
    label: str
    allowed_children: Dict[str, List[WorkItemKind]]
    default_roles: List[str]


class ErrorOut(BaseModel):
    code: str
    message: str


CalendarOut.model_rebuild()
