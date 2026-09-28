"""CU-13 create dependency, CU-14 configure lead/lag (RF-17..RF-23)."""
from __future__ import annotations

from dataclasses import dataclass

from app.application.use_cases.base import ProjectMutationUseCase
from app.domain.entities.dependency import Dependency
from app.domain.value_objects.duration import TimeUnit
from app.domain.value_objects.enums import DependencyType


@dataclass(frozen=True)
class CreateDependencyCommand:
    project_id: str
    predecessor_id: str
    successor_id: str
    type: DependencyType = DependencyType.FS
    lag_value: float = 0
    lag_unit: TimeUnit = TimeUnit.DAY


@dataclass(frozen=True)
class UpdateDependencyCommand:
    project_id: str
    dependency_id: str
    type: DependencyType
    lag_value: float
    lag_unit: TimeUnit


class CreateDependency(ProjectMutationUseCase):
    def execute(self, c: CreateDependencyCommand) -> Dependency:
        return self._mutate(c.project_id, lambda p: p.add_dependency(
            c.predecessor_id, c.successor_id, c.type, c.lag_value, c.lag_unit))


class UpdateDependency(ProjectMutationUseCase):
    def execute(self, c: UpdateDependencyCommand) -> None:
        self._mutate(c.project_id, lambda p: p.update_dependency(c.dependency_id, c.type, c.lag_value, c.lag_unit))


class DeleteDependency(ProjectMutationUseCase):
    def execute(self, project_id: str, dependency_id: str) -> None:
        self._mutate(project_id, lambda p: p.remove_dependency(dependency_id))
