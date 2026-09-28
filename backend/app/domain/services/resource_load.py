"""Daily workload per member and over-allocation detection (RF-11, RF-46).

The MVP does not level resources automatically: it reports the days in which the assigned
work exceeds the member's availability so the planner can react.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Dict, List

from app.domain.entities.project import Project
from app.domain.services.scheduler import calculator_for


@dataclass(frozen=True)
class DailyLoad:
    day: date
    minutes: int
    capacity_minutes: int

    @property
    def is_overallocated(self) -> bool:
        return self.minutes > self.capacity_minutes


@dataclass
class MemberLoad:
    member_id: str
    capacity_minutes_per_day: int
    days: List[DailyLoad] = field(default_factory=list)

    @property
    def total_minutes(self) -> int:
        return sum(d.minutes for d in self.days)

    @property
    def overallocated_days(self) -> List[DailyLoad]:
        return [d for d in self.days if d.is_overallocated]


class ResourceLoadAnalyzer:
    def analyze(self, project: Project) -> List[MemberLoad]:
        calculator = calculator_for(project)
        per_member: Dict[str, Dict[date, float]] = {member_id: {} for member_id in project.members}
        for assignment in project.assignments.values():
            item = project.items[assignment.work_item_id]
            if item.schedule is None or project.is_summary(item.id):
                continue  # summary work is represented by its children
            daily = per_member[assignment.member_id]
            for day, minutes in calculator.working_days_between(item.schedule.early_start, item.schedule.early_finish):
                daily[day] = daily.get(day, 0.0) + minutes * assignment.units / 100

        result = []
        for member in project.members.values():
            capacity = round(member.hours_per_day * 60)
            days = [DailyLoad(day, round(minutes), capacity)
                    for day, minutes in sorted(per_member[member.id].items())]
            result.append(MemberLoad(member.id, capacity, days))
        return result
