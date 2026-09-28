"""Builder that translates the WBS (hierarchy + dependencies) into a CPM activity network.

* Leaf items are activities with their own duration.
* Summary items (phases, sprints, tasks with subtasks) become two zero-duration nodes,
  ``<id>:start`` and ``<id>:finish``, linked as ``start -> every child -> finish``.
  Their dates are therefore derived from their children.
* A sprint also keeps its timebox: ``finish >= start + sprint duration``.
* A user dependency on a summary is attached to its start or finish node depending on the
  relation type, so Sprint->Sprint, Phase->Task, etc. need no special cases, and sprints
  without dependencies between them are scheduled in parallel (RN-25).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Callable, Dict, Iterable, List, Mapping, Optional

from app.domain.entities.dependency import Dependency
from app.domain.entities.work_item import WorkItem
from app.domain.services.cpm import Activity, Precedence
from app.domain.value_objects.enums import ConstraintType, DependencyType, WorkItemKind

START_SUFFIX = ":start"
FINISH_SUFFIX = ":finish"

# Resolves a constraint date to a working-minute offset: (date, at_end_of_day) -> offset
OffsetResolver = Callable[[date, bool], int]


@dataclass
class SchedulingNetwork:
    activities: Dict[str, Activity] = field(default_factory=dict)
    precedences: List[Precedence] = field(default_factory=list)
    start_node: Dict[str, str] = field(default_factory=dict)
    finish_node: Dict[str, str] = field(default_factory=dict)
    owner: Dict[str, str] = field(default_factory=dict)  # node id -> work item id


def children_index(items: Iterable[WorkItem]) -> Dict[Optional[str], List[WorkItem]]:
    index: Dict[Optional[str], List[WorkItem]] = {}
    for item in items:
        index.setdefault(item.parent_id, []).append(item)
    for siblings in index.values():
        siblings.sort(key=lambda it: it.sort_order)
    return index


class SchedulingNetworkBuilder:
    def __init__(self, items: Mapping[str, WorkItem], dependencies: Iterable[Dependency],
                 resolve_offset: Optional[OffsetResolver] = None) -> None:
        self._items = items
        self._dependencies = list(dependencies)
        self._resolve_offset = resolve_offset
        self._children = children_index(items.values())

    def build(self) -> SchedulingNetwork:
        network = SchedulingNetwork()
        for item in self._items.values():
            if self._children.get(item.id):
                self._add_summary(network, item)
            else:
                self._add_leaf(network, item)
        for item in self._items.values():
            for child in self._children.get(item.id, []):
                network.precedences.append(Precedence(network.start_node[item.id], network.start_node[child.id]))
                network.precedences.append(Precedence(network.finish_node[child.id], network.finish_node[item.id]))
        for dependency in self._dependencies:
            network.precedences.append(self._translate(network, dependency))
        return network

    def _add_leaf(self, network: SchedulingNetwork, item: WorkItem) -> None:
        duration = item.scheduled_minutes
        lower_bound = self._constraint_bound(item)
        if item.constraint.type == ConstraintType.FNET:
            lower_bound -= duration
        network.activities[item.id] = Activity(item.id, duration, max(0, lower_bound))
        network.start_node[item.id] = network.finish_node[item.id] = item.id
        network.owner[item.id] = item.id

    def _add_summary(self, network: SchedulingNetwork, item: WorkItem) -> None:
        start, finish = item.id + START_SUFFIX, item.id + FINISH_SUFFIX
        bound = self._constraint_bound(item)
        is_snet = item.constraint.type == ConstraintType.SNET
        network.activities[start] = Activity(start, 0, bound if is_snet else 0)
        network.activities[finish] = Activity(finish, 0, 0 if is_snet else bound)
        network.start_node[item.id], network.finish_node[item.id] = start, finish
        network.owner[start] = network.owner[finish] = item.id
        if item.kind == WorkItemKind.SPRINT and item.scheduled_minutes > 0:
            network.precedences.append(Precedence(start, finish, DependencyType.FS, item.scheduled_minutes))

    def _constraint_bound(self, item: WorkItem) -> int:
        constraint = item.constraint
        if constraint.type == ConstraintType.ASAP or constraint.day is None or self._resolve_offset is None:
            return 0
        return self._resolve_offset(constraint.day, constraint.type == ConstraintType.FNET)

    @staticmethod
    def _translate(network: SchedulingNetwork, dependency: Dependency) -> Precedence:
        kind = dependency.type
        source = (network.start_node if kind.uses_predecessor_start else network.finish_node)[dependency.predecessor_id]
        target = (network.finish_node if kind.constrains_successor_finish else network.start_node)[dependency.successor_id]
        return Precedence(source, target, kind, dependency.lag_minutes)
