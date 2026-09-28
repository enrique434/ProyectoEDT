"""WBS (EDT) use cases: CU-07..CU-10 phases, sprints, tasks, subtasks; CU-12 PERT; CU-19 progress."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Optional

from app.application.use_cases.base import ProjectMutationUseCase
from app.domain.entities.project import ItemFields, Project
from app.domain.entities.work_item import ScheduleConstraint, WorkItem
from app.domain.value_objects.duration import TimeUnit
from app.domain.value_objects.enums import (
    ConstraintType,
    DeletionStrategy,
    EstimationMode,
    ItemStatus,
    Priority,
    WorkItemKind,
)
from app.domain.value_objects.pert import PertEstimate


@dataclass(frozen=True)
class CreateItemCommand:
    project_id: str
    kind: WorkItemKind
    name: str
    parent_id: Optional[str] = None
    description: str = ""
    objective: str = ""
    duration_value: Optional[float] = None
    duration_unit: Optional[TimeUnit] = None


@dataclass(frozen=True)
class PertData:
    optimistic: float
    most_likely: float
    pessimistic: float


@dataclass(frozen=True)
class UpdateItemCommand:
    """Every field is optional: ``None`` means "leave unchanged"."""

    project_id: str
    item_id: str
    name: Optional[str] = None
    description: Optional[str] = None
    objective: Optional[str] = None
    kind: Optional[WorkItemKind] = None
    estimation_mode: Optional[EstimationMode] = None
    duration_value: Optional[float] = None
    duration_unit: Optional[TimeUnit] = None
    pert: Optional[PertData] = None
    constraint_type: Optional[ConstraintType] = None
    constraint_date: Optional[date] = None
    status: Optional[ItemStatus] = None
    priority: Optional[Priority] = None
    progress: Optional[int] = None


class CreateItem(ProjectMutationUseCase):
    def execute(self, command: CreateItemCommand) -> WorkItem:
        fields = ItemFields(command.description, command.objective, command.duration_value, command.duration_unit)
        return self._mutate(command.project_id,
                            lambda p: p.add_item(command.kind, command.name, command.parent_id, fields))


class UpdateItem(ProjectMutationUseCase):
    def execute(self, command: UpdateItemCommand) -> WorkItem:
        return self._mutate(command.project_id, lambda project: self._apply(project, command))

    @staticmethod
    def _apply(project: Project, c: UpdateItemCommand) -> WorkItem:
        item = project.get_item(c.item_id)
        if c.kind is not None:
            project.change_item_kind(item.id, c.kind)
        if c.name is not None:
            item.rename(c.name)
        if c.description is not None:
            item.description = c.description.strip()
        if c.objective is not None:
            item.objective = c.objective.strip()
        if c.priority is not None:
            item.priority = c.priority

        unit = c.duration_unit or item.duration_unit
        mode = c.estimation_mode or item.estimation_mode
        if mode == EstimationMode.PERT and c.pert is not None:
            item.apply_pert(PertEstimate(c.pert.optimistic, c.pert.most_likely, c.pert.pessimistic),
                            unit, project.converter)
        elif mode == EstimationMode.PERT and c.duration_unit is not None and item.pert is not None:
            item.apply_pert(item.pert, unit, project.converter)
        elif mode == EstimationMode.MANUAL and (c.duration_value is not None or c.estimation_mode is not None
                                                or c.duration_unit is not None):
            value = c.duration_value if c.duration_value is not None \
                else project.converter.from_minutes(item.duration_minutes, item.duration_unit)
            item.set_manual_duration(value, unit, project.converter)

        if c.constraint_type is not None:
            item.set_constraint(ScheduleConstraint(c.constraint_type, c.constraint_date))

        # Status first, then progress, each only when it really changed (RN-20, RN-21).
        original_status, original_progress = item.status, item.progress
        if c.status is not None and c.status != original_status:
            item.set_status(c.status)
        if c.progress is not None and c.progress != original_progress:
            item.set_progress(c.progress)
        return item


@dataclass(frozen=True)
class MoveItemCommand:
    project_id: str
    item_id: str
    parent_id: Optional[str]
    position: Optional[int] = None


class MoveItem(ProjectMutationUseCase):
    def execute(self, command: MoveItemCommand) -> None:
        self._mutate(command.project_id,
                     lambda p: p.move_item(command.item_id, command.parent_id, command.position))


class DeleteItem(ProjectMutationUseCase):
    def execute(self, project_id: str, item_id: str, strategy: DeletionStrategy = DeletionStrategy.REJECT) -> None:
        self._mutate(project_id, lambda p: p.remove_item(item_id, strategy))
