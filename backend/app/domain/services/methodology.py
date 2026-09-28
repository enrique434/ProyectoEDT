"""Structure rules per methodology (Strategy pattern, RN-04..RN-10, RNF-11).

The methodology never changes the scheduling algorithms; it only decides which WBS
structures can be created. Adding a methodology = adding a subclass and registering it.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Dict, FrozenSet, Mapping, Optional, Tuple

from app.domain.value_objects.enums import Methodology, WorkItemKind as K

ROOT: Optional[K] = None
Containment = Mapping[Optional[K], FrozenSet[K]]

_LEAF_CONTAINERS: Containment = {
    K.STORY: frozenset({K.SUBTASK}),
    K.TASK: frozenset({K.SUBTASK}),
    K.SUBTASK: frozenset(),
    K.MILESTONE: frozenset(),
}


class MethodologyRules(ABC):
    methodology: Methodology
    label: str

    @property
    @abstractmethod
    def containment(self) -> Containment:
        """Kinds each container (``None`` = project root) may hold."""

    @property
    @abstractmethod
    def default_roles(self) -> Tuple[str, ...]:
        """Roles seeded when a project is created (they remain configurable)."""

    def allowed_children(self, parent_kind: Optional[K]) -> FrozenSet[K]:
        return self.containment.get(parent_kind, frozenset())

    def can_contain(self, parent_kind: Optional[K], child_kind: K) -> bool:
        return child_kind in self.allowed_children(parent_kind)


class TraditionalRules(MethodologyRules):
    methodology = Methodology.TRADITIONAL
    label = "Tradicional"

    @property
    def containment(self) -> Containment:
        return {ROOT: frozenset({K.PHASE, K.MILESTONE}),
                K.PHASE: frozenset({K.TASK, K.MILESTONE}),
                K.SPRINT: frozenset(),
                **_LEAF_CONTAINERS}

    @property
    def default_roles(self) -> Tuple[str, ...]:
        return ("Project Manager", "Analista", "Arquitecto", "Desarrollador", "Tester", "Diseñador")


class AgileRules(MethodologyRules):
    methodology = Methodology.AGILE
    label = "Ágil"

    @property
    def containment(self) -> Containment:
        return {ROOT: frozenset({K.SPRINT, K.STORY, K.TASK, K.MILESTONE}),
                K.PHASE: frozenset(),
                K.SPRINT: frozenset({K.STORY, K.TASK, K.MILESTONE}),
                **_LEAF_CONTAINERS}

    @property
    def default_roles(self) -> Tuple[str, ...]:
        return ("Product Owner", "Scrum Master", "Development Team", "Tester/QA", "UX/UI", "DevOps")


class HybridRules(MethodologyRules):
    methodology = Methodology.HYBRID
    label = "Híbrido"

    @property
    def containment(self) -> Containment:
        return {ROOT: frozenset({K.PHASE, K.MILESTONE}),
                K.PHASE: frozenset({K.TASK, K.SPRINT, K.MILESTONE}),  # RN-07
                K.SPRINT: frozenset({K.STORY, K.TASK, K.MILESTONE}),
                **_LEAF_CONTAINERS}

    @property
    def default_roles(self) -> Tuple[str, ...]:
        return ("Project Manager", "Product Owner", "Scrum Master", "Desarrollador", "Analista", "Tester")


_REGISTRY: Dict[Methodology, MethodologyRules] = {
    rules.methodology: rules for rules in (TraditionalRules(), AgileRules(), HybridRules())
}


def rules_for(methodology: Methodology) -> MethodologyRules:
    return _REGISTRY[methodology]


def all_rules() -> Tuple[MethodologyRules, ...]:
    return tuple(_REGISTRY.values())
