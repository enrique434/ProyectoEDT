"""Enumerations of the planning vocabulary."""
from __future__ import annotations

from enum import Enum


class Methodology(str, Enum):
    TRADITIONAL = "traditional"
    AGILE = "agile"
    HYBRID = "hybrid"


class WorkItemKind(str, Enum):
    PHASE = "phase"
    SPRINT = "sprint"
    STORY = "story"
    TASK = "task"
    SUBTASK = "subtask"
    MILESTONE = "milestone"


class ItemStatus(str, Enum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    ON_HOLD = "on_hold"
    CANCELLED = "cancelled"


class Priority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class EstimationMode(str, Enum):
    MANUAL = "manual"
    PERT = "pert"


class ConstraintType(str, Enum):
    ASAP = "asap"  # as soon as possible (calculated)
    SNET = "snet"  # start no earlier than
    FNET = "fnet"  # finish no earlier than


class DependencyType(str, Enum):
    FS = "FS"  # finish -> start
    SS = "SS"  # start -> start
    FF = "FF"  # finish -> finish
    SF = "SF"  # start -> finish

    @property
    def uses_predecessor_start(self) -> bool:
        return self in (DependencyType.SS, DependencyType.SF)

    @property
    def constrains_successor_finish(self) -> bool:
        return self in (DependencyType.FF, DependencyType.SF)


class DeletionStrategy(str, Enum):
    """How to resolve dependencies when an activity is deleted (RN-28)."""

    REJECT = "reject"
    REMOVE = "remove"
    BRIDGE = "bridge"
