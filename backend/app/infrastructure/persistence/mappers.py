"""Data Mapper between domain entities and ORM models. The domain never sees SQLAlchemy."""
from __future__ import annotations

from datetime import time
from typing import Dict, List, Sequence, Tuple

from app.domain.entities.calendar import CalendarException, WorkCalendar, WorkInterval
from app.domain.entities.dependency import Dependency
from app.domain.entities.project import Project, ProjectSettings, ScheduleSummary
from app.domain.entities.resources import Assignment, Member, Role
from app.domain.entities.work_item import ScheduleConstraint, ScheduleResult, WorkItem
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
from app.domain.value_objects.pert import PertEstimate
from app.infrastructure.persistence.models import (
    AssignmentModel,
    CalendarExceptionModel,
    DependencyModel,
    MemberModel,
    ProjectModel,
    RoleModel,
    WorkItemModel,
)


# ------------------------------------------------------------------ calendar
def _intervals_to_json(intervals: Sequence[WorkInterval]) -> List[List[str]]:
    return [[iv.start.strftime("%H:%M"), iv.end.strftime("%H:%M")] for iv in intervals]


def _intervals_from_json(data: Sequence[Sequence[str]]) -> Tuple[WorkInterval, ...]:
    return tuple(WorkInterval(time.fromisoformat(start), time.fromisoformat(end)) for start, end in data)


# ------------------------------------------------------------------- to domain
def project_to_domain(m: ProjectModel) -> Project:
    settings = ProjectSettings(TimeUnit(m.default_time_unit), m.default_task_duration_minutes,
                               m.default_sprint_duration_minutes, m.minutes_per_day, m.days_per_week,
                               m.days_per_month)
    calendar = WorkCalendar(week={int(day): _intervals_from_json(ivs) for day, ivs in m.calendar_week.items()})
    calendar.set_exceptions(CalendarException(e.day, e.name, _intervals_from_json(e.intervals))
                            for e in m.calendar_exceptions)
    project = Project(m.id, m.name, Methodology(m.methodology), m.start_date, m.description, m.target_date,
                      settings, calendar, m.created_at, m.updated_at)
    for r in m.roles:
        project.roles[r.id] = Role(r.id, r.name, r.description)
    for mm in m.members:
        project.members[mm.id] = Member(mm.id, mm.name, mm.role_id, mm.email, mm.responsibility,
                                        mm.hours_per_day, mm.active)
    for i in m.items:
        project.items[i.id] = item_to_domain(i)
    for d in m.dependencies:
        project.dependencies[d.id] = Dependency(d.id, d.predecessor_id, d.successor_id, DependencyType(d.type),
                                                d.lag_minutes, TimeUnit(d.lag_unit))
    for a in m.assignments:
        project.assignments[a.id] = Assignment(a.id, a.work_item_id, a.member_id, a.units)
    if m.schedule_calculated_at is not None:
        project.schedule = ScheduleSummary(m.schedule_start, m.schedule_finish, m.schedule_duration_minutes or 0,
                                           list(m.schedule_critical_ids or []), m.schedule_std_dev_minutes or 0.0,
                                           m.schedule_target_probability, list(m.schedule_warnings or []),
                                           m.schedule_calculated_at)
    return project


def item_to_domain(m: WorkItemModel) -> WorkItem:
    pert = None
    if m.pert_optimistic is not None and m.pert_most_likely is not None and m.pert_pessimistic is not None:
        pert = PertEstimate(m.pert_optimistic, m.pert_most_likely, m.pert_pessimistic)
    schedule = None
    if m.early_start is not None and m.scheduled_start is not None:
        schedule = ScheduleResult(m.early_start, m.early_finish, m.late_start, m.late_finish, m.total_float,
                                  m.free_float, bool(m.is_critical), m.scheduled_start, m.scheduled_finish)
    return WorkItem(
        id=m.id, kind=WorkItemKind(m.kind), name=m.name, parent_id=m.parent_id, sort_order=m.sort_order,
        description=m.description, objective=m.objective, duration_minutes=m.duration_minutes,
        duration_unit=TimeUnit(m.duration_unit), estimation_mode=EstimationMode(m.estimation_mode), pert=pert,
        constraint=ScheduleConstraint(ConstraintType(m.constraint_type), m.constraint_date),
        status=ItemStatus(m.status), priority=Priority(m.priority), progress=m.progress, schedule=schedule)


# --------------------------------------------------------------------- to model
def update_project_model(p: Project, m: ProjectModel) -> None:
    m.id, m.name, m.description = p.id, p.name, p.description
    m.methodology, m.start_date, m.target_date = p.methodology.value, p.start_date, p.target_date
    s = p.settings
    m.default_time_unit = s.default_time_unit.value
    m.default_task_duration_minutes = s.default_task_duration_minutes
    m.default_sprint_duration_minutes = s.default_sprint_duration_minutes
    m.minutes_per_day, m.days_per_week, m.days_per_month = s.minutes_per_day, s.days_per_week, s.days_per_month
    m.calendar_week = {str(day): _intervals_to_json(ivs) for day, ivs in p.calendar.week.items()}
    summary = p.schedule
    m.schedule_start = summary.start if summary else None
    m.schedule_finish = summary.finish if summary else None
    m.schedule_duration_minutes = summary.duration_minutes if summary else None
    m.schedule_std_dev_minutes = summary.pert_std_dev_minutes if summary else None
    m.schedule_target_probability = summary.target_probability if summary else None
    m.schedule_critical_ids = list(summary.critical_item_ids) if summary else None
    m.schedule_warnings = list(summary.warnings) if summary else None
    m.schedule_calculated_at = summary.calculated_at if summary else None
    m.created_at, m.updated_at = p.created_at, p.updated_at


def exception_fields(e: CalendarException) -> Dict:
    return {"day": e.day, "name": e.name, "intervals": _intervals_to_json(e.intervals)}


def role_fields(r: Role) -> Dict:
    return {"id": r.id, "name": r.name, "description": r.description}


def member_fields(mm: Member) -> Dict:
    return {"id": mm.id, "name": mm.name, "role_id": mm.role_id, "email": mm.email,
            "responsibility": mm.responsibility, "hours_per_day": mm.hours_per_day, "active": mm.active}


def item_fields(i: WorkItem) -> Dict:
    pert, s = i.pert, i.schedule
    return {
        "id": i.id, "parent_id": i.parent_id, "kind": i.kind.value, "name": i.name, "description": i.description,
        "objective": i.objective, "sort_order": i.sort_order, "duration_minutes": i.duration_minutes,
        "duration_unit": i.duration_unit.value, "estimation_mode": i.estimation_mode.value,
        "pert_optimistic": pert.optimistic if pert else None,
        "pert_most_likely": pert.most_likely if pert else None,
        "pert_pessimistic": pert.pessimistic if pert else None,
        "constraint_type": i.constraint.type.value, "constraint_date": i.constraint.day,
        "status": i.status.value, "priority": i.priority.value, "progress": i.progress,
        "early_start": s.early_start if s else None, "early_finish": s.early_finish if s else None,
        "late_start": s.late_start if s else None, "late_finish": s.late_finish if s else None,
        "total_float": s.total_float if s else None, "free_float": s.free_float if s else None,
        "is_critical": s.is_critical if s else None,
        "scheduled_start": s.start if s else None, "scheduled_finish": s.finish if s else None,
    }


def dependency_fields(d: Dependency) -> Dict:
    return {"id": d.id, "predecessor_id": d.predecessor_id, "successor_id": d.successor_id, "type": d.type.value,
            "lag_minutes": d.lag_minutes, "lag_unit": d.lag_unit.value}


def assignment_fields(a: Assignment) -> Dict:
    return {"id": a.id, "work_item_id": a.work_item_id, "member_id": a.member_id, "units": a.units}


MODEL_FIELD_BUILDERS = {
    RoleModel: role_fields,
    MemberModel: member_fields,
    WorkItemModel: item_fields,
    DependencyModel: dependency_fields,
    AssignmentModel: assignment_fields,
    CalendarExceptionModel: exception_fields,
}
