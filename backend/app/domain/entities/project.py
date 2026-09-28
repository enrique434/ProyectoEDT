"""Project aggregate root.

Every change to the WBS, dependencies, team or calendar goes through this class so that
business rules are always enforced in one place (RN-01..RN-28). Projects never share data
with each other (RF-40).
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, replace
from datetime import date, datetime
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

from app.domain.entities.calendar import CalendarException, WorkCalendar, WorkInterval
from app.domain.entities.dependency import Dependency
from app.domain.entities.resources import Assignment, Member, Role
from app.domain.entities.work_item import WorkItem
from app.domain.errors import (
    ConflictingDependency,
    CycleError,
    DependencyConflictError,
    HierarchyRuleError,
    NotFoundError,
    ValidationError,
)
from app.domain.services.graph import topological_order
from app.domain.services.methodology import MethodologyRules, rules_for
from app.domain.services.network import SchedulingNetworkBuilder, children_index
from app.domain.value_objects.duration import DurationConverter, TimeUnit
from app.domain.value_objects.enums import (
    DeletionStrategy,
    DependencyType,
    EstimationMode,
    Methodology,
    WorkItemKind,
)

KIND_LABELS = {
    WorkItemKind.PHASE: "fase",
    WorkItemKind.SPRINT: "sprint",
    WorkItemKind.STORY: "historia",
    WorkItemKind.TASK: "tarea",
    WorkItemKind.SUBTASK: "subtarea",
    WorkItemKind.MILESTONE: "hito",
}


def new_id() -> str:
    return str(uuid.uuid4())


@dataclass(frozen=True)
class ProjectSettings:
    default_time_unit: TimeUnit = TimeUnit.DAY
    default_task_duration_minutes: int = 480  # 1 day
    default_sprint_duration_minutes: int = 4800  # 2 weeks
    minutes_per_day: int = 480
    days_per_week: int = 5
    days_per_month: int = 20

    def __post_init__(self) -> None:
        self.converter  # validates conversion parameters
        if self.default_task_duration_minutes < 0 or self.default_sprint_duration_minutes < 0:
            raise ValidationError("Las duraciones predeterminadas no pueden ser negativas")

    @property
    def converter(self) -> DurationConverter:
        return DurationConverter(self.minutes_per_day, self.days_per_week, self.days_per_month)


@dataclass
class ScheduleSummary:
    start: datetime
    finish: datetime
    duration_minutes: int
    critical_item_ids: List[str]
    pert_std_dev_minutes: float
    target_probability: Optional[float]
    warnings: List[str]
    calculated_at: datetime


@dataclass
class ItemFields:
    """Optional attributes accepted when creating an item."""

    description: str = ""
    objective: str = ""
    duration_value: Optional[float] = None
    duration_unit: Optional[TimeUnit] = None


class Project:
    def __init__(self, id: str, name: str, methodology: Methodology, start_date: date,
                 description: str = "", target_date: Optional[date] = None,
                 settings: Optional[ProjectSettings] = None, calendar: Optional[WorkCalendar] = None,
                 created_at: Optional[datetime] = None, updated_at: Optional[datetime] = None) -> None:
        self.id = id
        self.methodology = methodology
        self.settings = settings or ProjectSettings()
        self.calendar = calendar or WorkCalendar.standard()
        self.items: Dict[str, WorkItem] = {}
        self.dependencies: Dict[str, Dependency] = {}
        self.roles: Dict[str, Role] = {}
        self.members: Dict[str, Member] = {}
        self.assignments: Dict[str, Assignment] = {}
        self.schedule: Optional[ScheduleSummary] = None
        now = datetime.now()
        self.created_at = created_at or now
        self.updated_at = updated_at or now
        self.name = ""
        self.description = ""
        self.start_date = start_date
        self.target_date: Optional[date] = None
        self.update_details(name, description, start_date, target_date)

    # ================================================================ factory
    @classmethod
    def create(cls, name: str, methodology: Methodology, start_date: date, description: str = "",
               target_date: Optional[date] = None, settings: Optional[ProjectSettings] = None) -> "Project":
        project = cls(new_id(), name, methodology, start_date, description, target_date, settings)
        for role_name in project.rules.default_roles:
            project.add_role(role_name)
        return project

    # ================================================================ details
    @property
    def rules(self) -> MethodologyRules:
        return rules_for(self.methodology)

    @property
    def converter(self) -> DurationConverter:
        return self.settings.converter

    def touch(self, moment: datetime) -> None:
        self.updated_at = moment

    def update_details(self, name: str, description: str, start_date: date, target_date: Optional[date]) -> None:
        cleaned = (name or "").strip()
        if not cleaned:
            raise ValidationError("El nombre del proyecto es obligatorio")
        if len(cleaned) > 150:
            raise ValidationError("El nombre del proyecto no puede superar 150 caracteres")
        if target_date is not None and target_date < start_date:
            raise ValidationError("La fecha objetivo no puede ser anterior a la fecha de inicio")
        self.name, self.description = cleaned, (description or "").strip()
        self.start_date, self.target_date = start_date, target_date

    def change_methodology(self, methodology: Methodology) -> None:
        rules = rules_for(methodology)
        for item in self.items.values():
            parent_kind = self.items[item.parent_id].kind if item.parent_id else None
            if not rules.can_contain(parent_kind, item.kind):
                raise HierarchyRuleError(
                    f"No se puede cambiar a {rules.label}: '{item.name}' ({KIND_LABELS[item.kind]}) "
                    f"no está permitido dentro de {self._container_label(parent_kind)}")
        self.methodology = methodology

    def update_settings(self, settings: ProjectSettings) -> None:
        """Keeps the user's intent: '5 days' stays 5 days even if a day changes its length."""
        old, new = self.converter, settings.converter
        for item in self.items.values():
            if item.estimation_mode == EstimationMode.PERT and item.pert is not None:
                item.apply_pert(item.pert, item.duration_unit, new)
            else:
                item.duration_minutes = new.to_minutes(old.from_minutes(item.duration_minutes, item.duration_unit),
                                                       item.duration_unit)
        for dependency in self.dependencies.values():
            dependency.lag_minutes = new.to_minutes(old.from_minutes(dependency.lag_minutes, dependency.lag_unit),
                                                    dependency.lag_unit)
        self.settings = settings

    def set_calendar(self, week: Dict[int, Iterable[WorkInterval]], exceptions: Iterable[CalendarException]) -> None:
        calendar = WorkCalendar(week={d: tuple(ivs) for d, ivs in week.items()})
        calendar.set_exceptions(exceptions)
        self.calendar = calendar

    # ============================================================ WBS queries
    def get_item(self, item_id: str) -> WorkItem:
        try:
            return self.items[item_id]
        except KeyError:
            raise NotFoundError("Actividad", item_id) from None

    def children(self, parent_id: Optional[str]) -> List[WorkItem]:
        return sorted((i for i in self.items.values() if i.parent_id == parent_id), key=lambda i: i.sort_order)

    def is_summary(self, item_id: str) -> bool:
        return any(i.parent_id == item_id for i in self.items.values())

    def ancestors(self, item_id: str) -> List[str]:
        result, current = [], self.get_item(item_id).parent_id
        while current is not None:
            result.append(current)
            current = self.items[current].parent_id
        return result

    def subtree_ids(self, item_id: str) -> List[str]:
        index = children_index(self.items.values())
        result, stack = [], [item_id]
        while stack:
            current = stack.pop()
            result.append(current)
            stack.extend(child.id for child in index.get(current, []))
        return result

    def wbs_outline(self) -> List[Tuple[WorkItem, str, int]]:
        """Items in outline order with their WBS code (1, 1.2, 1.2.3) and level (RF-41)."""
        index = children_index(self.items.values())
        result: List[Tuple[WorkItem, str, int]] = []

        def visit(parent_id: Optional[str], prefix: str, level: int) -> None:
            for position, child in enumerate(index.get(parent_id, []), start=1):
                code = f"{prefix}{position}"
                result.append((child, code, level))
                visit(child.id, code + ".", level + 1)

        visit(None, "", 0)
        return result

    # ============================================================ WBS commands
    def add_item(self, kind: WorkItemKind, name: str, parent_id: Optional[str] = None,
                 fields: Optional[ItemFields] = None) -> WorkItem:
        fields = fields or ItemFields()
        parent_kind = self.get_item(parent_id).kind if parent_id else None
        self._check_containment(parent_kind, kind)
        unit = fields.duration_unit or self.settings.default_time_unit
        item = WorkItem(id=new_id(), kind=kind, name=name, parent_id=parent_id,
                        sort_order=self._next_sort_order(parent_id), description=fields.description,
                        objective=fields.objective, duration_unit=unit,
                        duration_minutes=self._default_duration(kind))
        if fields.duration_value is not None:
            item.set_manual_duration(fields.duration_value, unit, self.converter)
        self.items[item.id] = item
        return item

    def change_item_kind(self, item_id: str, kind: WorkItemKind) -> None:
        item = self.get_item(item_id)
        if kind == item.kind:
            return
        parent_kind = self.items[item.parent_id].kind if item.parent_id else None
        self._check_containment(parent_kind, kind)
        for child in self.children(item_id):
            if not self.rules.can_contain(kind, child.kind):
                raise HierarchyRuleError(
                    f"Una {KIND_LABELS[kind]} no puede contener '{child.name}' ({KIND_LABELS[child.kind]})")
        was_milestone = item.is_milestone
        item.kind = kind
        if item.is_milestone:
            item.set_manual_duration(0, item.duration_unit, self.converter)
            item.pert = None
        elif was_milestone:
            item.duration_minutes = self._default_duration(kind)

    def move_item(self, item_id: str, new_parent_id: Optional[str], position: Optional[int] = None) -> None:
        item = self.get_item(item_id)
        if new_parent_id is not None:
            parent = self.get_item(new_parent_id)
            if new_parent_id == item_id or item_id in self.ancestors(new_parent_id):
                raise HierarchyRuleError("No se puede mover un elemento dentro de sí mismo o de sus descendientes")
            self._check_containment(parent.kind, item.kind)
        else:
            self._check_containment(None, item.kind)

        previous_parent, previous_order = item.parent_id, item.sort_order
        item.parent_id = new_parent_id
        try:
            self._check_dependencies_vs_hierarchy(self.dependencies.values())
            self.ensure_acyclic()
        except Exception:
            item.parent_id, item.sort_order = previous_parent, previous_order
            raise
        siblings = [s for s in self.children(new_parent_id) if s.id != item_id]
        index = len(siblings) if position is None else max(0, min(position, len(siblings)))
        siblings.insert(index, item)
        self._renumber(siblings)
        if previous_parent != new_parent_id:
            self._renumber(self.children(previous_parent))

    def remove_item(self, item_id: str, strategy: DeletionStrategy = DeletionStrategy.REJECT) -> None:
        item = self.get_item(item_id)
        doomed: Set[str] = set(self.subtree_ids(item_id))
        external = [d for d in self.dependencies.values()
                    if (d.predecessor_id in doomed) != (d.successor_id in doomed)]
        if external and strategy == DeletionStrategy.REJECT:
            raise DependencyConflictError(  # RN-28
                f"'{item.name}' tiene {len(external)} dependencia(s) con otras actividades. "
                "Elimínelas o elija cómo resolverlas.",
                [ConflictingDependency(d.id, d.predecessor_id, d.successor_id) for d in external])

        bridges: List[Tuple[str, str]] = []
        if strategy == DeletionStrategy.BRIDGE:
            predecessors = {d.predecessor_id for d in external if d.successor_id in doomed}
            successors = {d.successor_id for d in external if d.predecessor_id in doomed}
            bridges = [(p, s) for p in predecessors for s in successors if p != s]

        for dependency in [d for d in self.dependencies.values() if d.involves_any(doomed)]:
            del self.dependencies[dependency.id]
        for assignment in [a for a in self.assignments.values() if a.work_item_id in doomed]:
            del self.assignments[assignment.id]
        for doomed_id in doomed:
            del self.items[doomed_id]
        self._renumber(self.children(item.parent_id))

        for predecessor, successor in bridges:
            if self._find_dependency(predecessor, successor) is None:
                try:
                    self.add_dependency(predecessor, successor)
                except (CycleError, ValidationError):
                    continue  # a bridge that would be invalid is simply skipped

    # ========================================================== dependencies
    def get_dependency(self, dependency_id: str) -> Dependency:
        try:
            return self.dependencies[dependency_id]
        except KeyError:
            raise NotFoundError("Dependencia", dependency_id) from None

    def add_dependency(self, predecessor_id: str, successor_id: str, type: DependencyType = DependencyType.FS,
                       lag_value: float = 0, lag_unit: TimeUnit = TimeUnit.DAY) -> Dependency:
        self.get_item(predecessor_id), self.get_item(successor_id)
        if self._find_dependency(predecessor_id, successor_id) is not None:
            raise ValidationError("Ya existe una dependencia entre esas dos actividades")
        dependency = Dependency(new_id(), predecessor_id, successor_id, type,
                                self.converter.to_minutes(lag_value, lag_unit), lag_unit)
        self._check_dependencies_vs_hierarchy([dependency])
        self.dependencies[dependency.id] = dependency
        try:
            self.ensure_acyclic()
        except CycleError:
            del self.dependencies[dependency.id]
            raise
        return dependency

    def update_dependency(self, dependency_id: str, type: DependencyType, lag_value: float, lag_unit: TimeUnit) -> None:
        dependency = self.get_dependency(dependency_id)
        snapshot = replace(dependency)
        dependency.type, dependency.lag_unit = type, lag_unit
        dependency.lag_minutes = self.converter.to_minutes(lag_value, lag_unit)
        try:
            self.ensure_acyclic()
        except CycleError:
            self.dependencies[dependency_id] = snapshot
            raise

    def remove_dependency(self, dependency_id: str) -> None:
        self.get_dependency(dependency_id)
        del self.dependencies[dependency_id]

    def ensure_acyclic(self) -> None:
        """Validates the expanded network (hierarchy + dependencies) — RN-11, RN-12."""
        network = SchedulingNetworkBuilder(self.items, self.dependencies.values()).build()
        edges = [(p.predecessor, p.successor) for p in network.precedences]
        try:
            topological_order(list(network.activities), edges)
        except CycleError as error:
            names: List[str] = []
            for node in error.cycle:
                name = self.items[network.owner[node]].name
                if not names or names[-1] != name:
                    names.append(name)
            raise CycleError("Dependencia circular: " + " → ".join(names), names) from None

    # ================================================================== team
    def add_role(self, name: str, description: str = "") -> Role:
        self._ensure_unique_role_name(name)
        role = Role(new_id(), name, description)
        self.roles[role.id] = role
        return role

    def update_role(self, role_id: str, name: str, description: str) -> None:
        role = self._get(self.roles, role_id, "Rol")
        self._ensure_unique_role_name(name, exclude=role_id)
        role.name, role.description = Role(role_id, name).name, description.strip()

    def remove_role(self, role_id: str) -> None:
        self._get(self.roles, role_id, "Rol")
        for member in self.members.values():
            if member.role_id == role_id:
                member.role_id = None
        del self.roles[role_id]

    def add_member(self, member: Member) -> Member:
        self._check_role(member.role_id)
        member.id = member.id or new_id()
        self.members[member.id] = member
        return member

    def update_member(self, member: Member) -> None:
        self._get(self.members, member.id, "Integrante")
        self._check_role(member.role_id)
        self.members[member.id] = member

    def remove_member(self, member_id: str) -> None:
        self._get(self.members, member_id, "Integrante")
        for assignment in [a for a in self.assignments.values() if a.member_id == member_id]:
            del self.assignments[assignment.id]
        del self.members[member_id]

    def set_assignments(self, item_id: str, allocations: Sequence[Tuple[str, int]]) -> None:
        """Replaces the responsible people of an activity (RF-16). ``allocations`` = (member_id, units %)."""
        self.get_item(item_id)
        member_ids = [member_id for member_id, _ in allocations]
        if len(set(member_ids)) != len(member_ids):
            raise ValidationError("Un integrante no puede asignarse dos veces a la misma actividad")
        new = [Assignment(new_id(), item_id, self._get(self.members, member_id, "Integrante").id, units)
               for member_id, units in allocations]
        for assignment in [a for a in self.assignments.values() if a.work_item_id == item_id]:
            del self.assignments[assignment.id]
        for assignment in new:
            self.assignments[assignment.id] = assignment

    def assignments_of(self, item_id: str) -> List[Assignment]:
        return [a for a in self.assignments.values() if a.work_item_id == item_id]

    # =============================================================== helpers
    def _check_containment(self, parent_kind: Optional[WorkItemKind], kind: WorkItemKind) -> None:
        if not self.rules.can_contain(parent_kind, kind):
            raise HierarchyRuleError(
                f"En un proyecto {self.rules.label.lower()} no se puede crear una {KIND_LABELS[kind]} "
                f"dentro de {self._container_label(parent_kind)}")

    @staticmethod
    def _container_label(kind: Optional[WorkItemKind]) -> str:
        return "la raíz del proyecto" if kind is None else f"una {KIND_LABELS[kind]}"

    def _check_dependencies_vs_hierarchy(self, dependencies: Iterable[Dependency]) -> None:
        for dependency in dependencies:
            if dependency.predecessor_id in self.ancestors(dependency.successor_id) or \
                    dependency.successor_id in self.ancestors(dependency.predecessor_id):
                raise ValidationError("No se puede crear una dependencia entre un elemento y su contenedor: "
                                      "la jerarquía ya determina su relación")

    def _find_dependency(self, predecessor_id: str, successor_id: str) -> Optional[Dependency]:
        return next((d for d in self.dependencies.values()
                     if d.predecessor_id == predecessor_id and d.successor_id == successor_id), None)

    def _default_duration(self, kind: WorkItemKind) -> int:
        if kind == WorkItemKind.SPRINT:
            return self.settings.default_sprint_duration_minutes
        if kind in (WorkItemKind.TASK, WorkItemKind.STORY, WorkItemKind.SUBTASK):
            return self.settings.default_task_duration_minutes
        return 0

    def _next_sort_order(self, parent_id: Optional[str]) -> int:
        return max((s.sort_order for s in self.children(parent_id)), default=-1) + 1

    @staticmethod
    def _renumber(siblings: Sequence[WorkItem]) -> None:
        for order, sibling in enumerate(siblings):
            sibling.sort_order = order

    def _ensure_unique_role_name(self, name: str, exclude: Optional[str] = None) -> None:
        normalized = (name or "").strip().lower()
        if any(r.name.lower() == normalized and r.id != exclude for r in self.roles.values()):
            raise ValidationError(f"Ya existe el rol '{name.strip()}'")

    def _check_role(self, role_id: Optional[str]) -> None:
        if role_id is not None:
            self._get(self.roles, role_id, "Rol")

    @staticmethod
    def _get(collection: Dict, key: str, label: str):
        try:
            return collection[key]
        except KeyError:
            raise NotFoundError(label, key) from None
