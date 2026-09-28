"""CU-04 Configure calendar (RF-07, RF-08)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, time
from typing import Dict, List, Tuple

from app.application.use_cases.base import ProjectMutationUseCase
from app.domain.entities.calendar import CalendarException, WorkInterval
from app.domain.entities.project import Project

TimeRange = Tuple[time, time]


@dataclass(frozen=True)
class ExceptionData:
    day: date
    name: str
    intervals: List[TimeRange] = field(default_factory=list)


@dataclass(frozen=True)
class UpdateCalendarCommand:
    project_id: str
    week: Dict[int, List[TimeRange]]
    exceptions: List[ExceptionData]


class UpdateCalendar(ProjectMutationUseCase):
    def execute(self, command: UpdateCalendarCommand) -> Project:
        week = {day: [WorkInterval(start, end) for start, end in ranges] for day, ranges in command.week.items()}
        exceptions = [CalendarException(e.day, e.name, tuple(WorkInterval(s, f) for s, f in e.intervals))
                      for e in command.exceptions]

        def change(project: Project) -> Project:
            project.set_calendar(week, exceptions)
            return project

        return self._mutate(command.project_id, change)
