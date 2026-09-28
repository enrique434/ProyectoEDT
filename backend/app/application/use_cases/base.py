"""Template Method shared by every use case that modifies a project.

load -> change -> reschedule (RN-23, RN-24, RF-39) -> save -> commit, all in one transaction.
"""
from __future__ import annotations

from datetime import datetime
from typing import Callable, TypeVar

from app.application.ports import Clock, UnitOfWorkFactory
from app.domain.entities.project import Project
from app.domain.services.scheduler import ProjectScheduler

T = TypeVar("T")


class UseCase:
    def __init__(self, uow_factory: UnitOfWorkFactory, scheduler: ProjectScheduler,
                 clock: Clock = datetime.now) -> None:
        self._uow_factory = uow_factory
        self._scheduler = scheduler
        self._clock = clock


class ProjectMutationUseCase(UseCase):
    def _mutate(self, project_id: str, change: Callable[[Project], T]) -> T:
        with self._uow_factory() as uow:
            project = uow.projects.get(project_id)
            result = change(project)
            self._scheduler.schedule(project)
            project.touch(self._clock())
            uow.projects.save(project)
            uow.commit()
            return result
