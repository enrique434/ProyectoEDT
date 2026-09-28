"""Project use cases: CU-01 create, CU-02 open, CU-03 save, list, edit, delete, recalculate."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import List, Optional

from app.application.ports import ProjectListing
from app.application.samples import SampleProjectFactory
from app.application.use_cases.base import ProjectMutationUseCase, UseCase
from app.domain.entities.project import Project, ProjectSettings
from app.domain.value_objects.enums import Methodology


@dataclass(frozen=True)
class CreateProjectCommand:
    name: str
    methodology: Methodology
    start_date: date
    description: str = ""
    target_date: Optional[date] = None
    settings: Optional[ProjectSettings] = None


@dataclass(frozen=True)
class UpdateProjectCommand:
    project_id: str
    name: str
    description: str
    methodology: Methodology
    start_date: date
    target_date: Optional[date]
    settings: ProjectSettings


class _NewProjectUseCase(UseCase):
    def _persist_new(self, project: Project) -> Project:
        self._scheduler.schedule(project)
        with self._uow_factory() as uow:
            uow.projects.add(project)
            uow.commit()
        return project


class CreateProject(_NewProjectUseCase):
    def execute(self, command: CreateProjectCommand) -> Project:
        return self._persist_new(Project.create(command.name, command.methodology, command.start_date,
                                                command.description, command.target_date, command.settings))


class CreateSampleProject(_NewProjectUseCase):
    """Creates a demonstration project that exercises the full planning cycle (RF-47)."""

    def execute(self, methodology: Methodology, start_date: date) -> Project:
        return self._persist_new(SampleProjectFactory().build(methodology, start_date))


class GetProject(UseCase):
    def execute(self, project_id: str) -> Project:
        with self._uow_factory() as uow:
            return uow.projects.get(project_id)


class ListProjects(UseCase):
    def execute(self) -> List[ProjectListing]:
        with self._uow_factory() as uow:
            return uow.projects.list()


class UpdateProject(ProjectMutationUseCase):
    def execute(self, command: UpdateProjectCommand) -> Project:
        def change(project: Project) -> Project:
            project.update_details(command.name, command.description, command.start_date, command.target_date)
            if command.methodology != project.methodology:
                project.change_methodology(command.methodology)
            if command.settings != project.settings:
                project.update_settings(command.settings)
            return project

        return self._mutate(command.project_id, change)


class DeleteProject(UseCase):
    def execute(self, project_id: str) -> None:
        with self._uow_factory() as uow:
            uow.projects.delete(project_id)
            uow.commit()


class RecalculateSchedule(ProjectMutationUseCase):
    def execute(self, project_id: str) -> Project:
        return self._mutate(project_id, lambda project: project)
