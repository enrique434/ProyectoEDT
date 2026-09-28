"""Domain exceptions. They carry business meaning and are translated to HTTP by the API layer."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence


class DomainError(Exception):
    """Base class for every business rule violation."""

    code = "domain_error"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class ValidationError(DomainError):
    code = "validation_error"


class NotFoundError(DomainError):
    code = "not_found"

    def __init__(self, entity: str, entity_id: str) -> None:
        super().__init__(f"{entity} '{entity_id}' no existe")
        self.entity = entity
        self.entity_id = entity_id


class HierarchyRuleError(DomainError):
    """The methodology does not allow the requested parent/child combination (RN-04..RN-10)."""

    code = "hierarchy_rule"


class CycleError(DomainError):
    """A dependency would create a cycle (RN-11, RN-12)."""

    code = "dependency_cycle"

    def __init__(self, message: str, cycle: Sequence[str]) -> None:
        super().__init__(message)
        self.cycle = list(cycle)


@dataclass(frozen=True)
class ConflictingDependency:
    id: str
    predecessor_id: str
    successor_id: str


class DependencyConflictError(DomainError):
    """Removing an activity requires resolving its dependencies first (RN-28)."""

    code = "dependency_conflict"

    def __init__(self, message: str, dependencies: Sequence[ConflictingDependency]) -> None:
        super().__init__(message)
        self.dependencies = list(dependencies)
