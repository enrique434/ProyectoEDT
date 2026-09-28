"""CU-05 members, CU-06 roles, CU-11 assign responsibles."""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Tuple

from app.application.use_cases.base import ProjectMutationUseCase, UseCase
from app.domain.entities.project import Project
from app.domain.entities.resources import Member, Role
from app.domain.services.resource_load import MemberLoad, ResourceLoadAnalyzer


@dataclass(frozen=True)
class RoleData:
    name: str
    description: str = ""


@dataclass(frozen=True)
class MemberData:
    name: str
    role_id: Optional[str] = None
    email: str = ""
    responsibility: str = ""
    hours_per_day: float = 8.0
    active: bool = True

    def to_member(self, member_id: str) -> Member:
        return Member(member_id, self.name, self.role_id, self.email.strip(), self.responsibility.strip(),
                      self.hours_per_day, self.active)


class CreateRole(ProjectMutationUseCase):
    def execute(self, project_id: str, data: RoleData) -> Role:
        return self._mutate(project_id, lambda p: p.add_role(data.name, data.description))


class UpdateRole(ProjectMutationUseCase):
    def execute(self, project_id: str, role_id: str, data: RoleData) -> None:
        self._mutate(project_id, lambda p: p.update_role(role_id, data.name, data.description))


class DeleteRole(ProjectMutationUseCase):
    def execute(self, project_id: str, role_id: str) -> None:
        self._mutate(project_id, lambda p: p.remove_role(role_id))


class CreateMember(ProjectMutationUseCase):
    def execute(self, project_id: str, data: MemberData) -> Member:
        return self._mutate(project_id, lambda p: p.add_member(data.to_member("")))


class UpdateMember(ProjectMutationUseCase):
    def execute(self, project_id: str, member_id: str, data: MemberData) -> None:
        self._mutate(project_id, lambda p: p.update_member(data.to_member(member_id)))


class DeleteMember(ProjectMutationUseCase):
    def execute(self, project_id: str, member_id: str) -> None:
        self._mutate(project_id, lambda p: p.remove_member(member_id))


class SetAssignments(ProjectMutationUseCase):
    def execute(self, project_id: str, item_id: str, allocations: List[Tuple[str, int]]) -> Project:
        def change(project: Project) -> Project:
            project.set_assignments(item_id, allocations)
            return project

        return self._mutate(project_id, change)


class GetResourceLoad(UseCase):
    def execute(self, project_id: str) -> Tuple[Project, List[MemberLoad]]:
        with self._uow_factory() as uow:
            project = uow.projects.get(project_id)
        return project, ResourceLoadAnalyzer().analyze(project)
