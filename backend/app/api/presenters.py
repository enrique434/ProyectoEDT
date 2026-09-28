"""Translate domain objects into response schemas."""
from __future__ import annotations

from typing import Dict, List

from app.api import schemas as s
from app.application.ports import ProjectListing
from app.domain.entities.project import Project, ProjectSettings
from app.domain.services.methodology import MethodologyRules, all_rules
from app.domain.services.resource_load import MemberLoad
from app.domain.value_objects.duration import TimeUnit

ROOT_KEY = "root"


def _intervals(intervals) -> List[s.IntervalOut]:
    return [s.IntervalOut(start=iv.start.strftime("%H:%M"), end=iv.end.strftime("%H:%M")) for iv in intervals]


def containment(rules: MethodologyRules) -> Dict[str, List]:
    return {(kind.value if kind else ROOT_KEY): sorted(children, key=lambda k: k.value)
            for kind, children in rules.containment.items()}


def settings_out(settings: ProjectSettings) -> s.SettingsOut:
    c = settings.converter
    task_unit = settings.default_time_unit
    sprint_unit = TimeUnit.WEEK
    return s.SettingsOut(
        default_time_unit=settings.default_time_unit,
        default_task_duration=s.DurationIn(value=c.from_minutes(settings.default_task_duration_minutes, task_unit),
                                           unit=task_unit),
        default_sprint_duration=s.DurationIn(
            value=c.from_minutes(settings.default_sprint_duration_minutes, sprint_unit), unit=sprint_unit),
        hours_per_day=settings.minutes_per_day / 60,
        days_per_week=settings.days_per_week,
        days_per_month=settings.days_per_month,
        minutes_per_day=settings.minutes_per_day,
    )


def project_out(p: Project) -> s.ProjectOut:
    converter = p.converter
    items = []
    for row, (item, code, level) in enumerate(p.wbs_outline(), start=1):
        sched = item.schedule
        pert = item.pert
        items.append(s.ItemOut(
            id=item.id, parent_id=item.parent_id, row=row, wbs_code=code, level=level, kind=item.kind,
            name=item.name, description=item.description, objective=item.objective,
            is_summary=p.is_summary(item.id), duration_minutes=item.duration_minutes,
            duration_value=round(converter.from_minutes(item.duration_minutes, item.duration_unit), 2),
            duration_unit=item.duration_unit, estimation_mode=item.estimation_mode,
            pert=s.PertOut(optimistic=pert.optimistic, most_likely=pert.most_likely, pessimistic=pert.pessimistic,
                           expected=round(pert.expected, 2), std_dev=round(pert.standard_deviation, 2))
            if pert else None,
            constraint_type=item.constraint.type, constraint_date=item.constraint.day,
            status=item.status, priority=item.priority, progress=item.progress,
            assignments=[s.AllocationOut(member_id=a.member_id, units=a.units) for a in p.assignments_of(item.id)],
            schedule=s.ItemScheduleOut(start=sched.start, finish=sched.finish, early_start=sched.early_start,
                                       early_finish=sched.early_finish, late_start=sched.late_start,
                                       late_finish=sched.late_finish, total_float=sched.total_float,
                                       free_float=sched.free_float, is_critical=sched.is_critical)
            if sched else None,
        ))

    summary = p.schedule
    return s.ProjectOut(
        id=p.id, name=p.name, description=p.description, methodology=p.methodology, start_date=p.start_date,
        target_date=p.target_date, settings=settings_out(p.settings),
        calendar=s.CalendarOut(
            week={day: _intervals(ivs) for day, ivs in p.calendar.week.items()},
            exceptions=[s.CalendarExceptionOut(day=e.day, name=e.name, is_working=e.is_working,
                                               intervals=_intervals(e.intervals))
                        for e in sorted(p.calendar.exceptions.values(), key=lambda e: e.day)]),
        allowed_children=containment(p.rules),
        roles=[s.RoleOut(id=r.id, name=r.name, description=r.description) for r in p.roles.values()],
        members=[s.MemberOut(id=m.id, name=m.name, role_id=m.role_id, email=m.email, responsibility=m.responsibility,
                             hours_per_day=m.hours_per_day, active=m.active) for m in p.members.values()],
        items=items,
        dependencies=[s.DependencyOut(id=d.id, predecessor_id=d.predecessor_id, successor_id=d.successor_id,
                                      type=d.type, lag_minutes=d.lag_minutes,
                                      lag_value=round(converter.from_minutes(d.lag_minutes, d.lag_unit), 2),
                                      lag_unit=d.lag_unit) for d in p.dependencies.values()],
        schedule=s.ScheduleOut(
            start=summary.start, finish=summary.finish, duration_minutes=summary.duration_minutes,
            duration_days=round(summary.duration_minutes / p.settings.minutes_per_day, 2),
            critical_item_ids=summary.critical_item_ids, pert_std_dev_minutes=summary.pert_std_dev_minutes,
            target_probability=summary.target_probability, warnings=summary.warnings,
            calculated_at=summary.calculated_at) if summary else None,
        created_at=p.created_at, updated_at=p.updated_at,
    )


def listing_out(listing: ProjectListing) -> s.ProjectListItemOut:
    return s.ProjectListItemOut(**listing.__dict__)


def resource_load_out(project: Project, loads: List[MemberLoad]) -> List[s.MemberLoadOut]:
    return [s.MemberLoadOut(
        member_id=load.member_id, name=project.members[load.member_id].name,
        active=project.members[load.member_id].active,
        capacity_minutes_per_day=load.capacity_minutes_per_day, total_minutes=load.total_minutes,
        overallocated_days=len(load.overallocated_days),
        days=[s.DailyLoadOut(day=d.day, minutes=d.minutes, overallocated=d.is_overallocated) for d in load.days],
    ) for load in loads]


def methodologies_out() -> List[s.MethodologyOut]:
    return [s.MethodologyOut(value=r.methodology, label=r.label, allowed_children=containment(r),
                             default_roles=list(r.default_roles)) for r in all_rules()]


def settings_from(data: s.SettingsIn) -> ProjectSettings:
    """Inverse of ``settings_out``: user units -> internal minutes."""
    minutes_per_day = round(data.hours_per_day * 60)
    draft = ProjectSettings(minutes_per_day=minutes_per_day, days_per_week=data.days_per_week,
                            days_per_month=data.days_per_month)
    c = draft.converter
    return ProjectSettings(
        default_time_unit=data.default_time_unit,
        default_task_duration_minutes=c.to_minutes(data.default_task_duration.value, data.default_task_duration.unit),
        default_sprint_duration_minutes=c.to_minutes(data.default_sprint_duration.value,
                                                     data.default_sprint_duration.unit),
        minutes_per_day=minutes_per_day, days_per_week=data.days_per_week, days_per_month=data.days_per_month)


def week_from(data: s.CalendarIn) -> Dict:
    return {d.weekday: [(iv.start, iv.end) for iv in d.intervals] for d in data.week}

