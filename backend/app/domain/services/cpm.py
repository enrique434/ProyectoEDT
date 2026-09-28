"""Critical Path Method over a Precedence Diagram (RF-28..RF-32).

Pure algorithm: it knows nothing about dates, calendars or the WBS. Times are integers
(working minutes). Supports FS, SS, FF and SF relations with lag (positive) or lead (negative).

Forward pass (successor s, predecessor p, duration d, lag L):
    FS: ES_s >= EF_p + L          SS: ES_s >= ES_p + L
    FF: ES_s >= EF_p + L - d_s    SF: ES_s >= ES_p + L - d_s
Backward pass:
    FS: LF_p <= LS_s - L          SS: LF_p <= LS_s - L + d_p
    FF: LF_p <= LF_s - L          SF: LF_p <= LF_s - L + d_p
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Mapping, Sequence

from app.domain.services.graph import topological_order
from app.domain.value_objects.enums import DependencyType


@dataclass(frozen=True)
class Activity:
    id: str
    duration: int
    earliest_start: int = 0  # lower bound from project start or a date constraint


@dataclass(frozen=True)
class Precedence:
    predecessor: str
    successor: str
    type: DependencyType = DependencyType.FS
    lag: int = 0


@dataclass(frozen=True)
class NodeTimes:
    es: int
    ef: int
    ls: int
    lf: int
    total_float: int
    free_float: int

    @property
    def is_critical(self) -> bool:
        return self.total_float <= 0  # RN-22


@dataclass(frozen=True)
class CpmResult:
    times: Mapping[str, NodeTimes]
    project_duration: int
    order: Sequence[str]
    driving: Sequence[Precedence]  # relations that determine the successor's ES (tight)


class CpmEngine:
    def compute(self, activities: Iterable[Activity], precedences: Iterable[Precedence]) -> CpmResult:
        nodes: Dict[str, Activity] = {a.id: a for a in activities}
        relations = list(precedences)
        order = topological_order(list(nodes), [(r.predecessor, r.successor) for r in relations])

        incoming: Dict[str, List[Precedence]] = {node: [] for node in nodes}
        outgoing: Dict[str, List[Precedence]] = {node: [] for node in nodes}
        for relation in relations:
            incoming[relation.successor].append(relation)
            outgoing[relation.predecessor].append(relation)

        es: Dict[str, int] = {}
        ef: Dict[str, int] = {}
        for node in order:
            duration = nodes[node].duration
            start = max(0, nodes[node].earliest_start)
            for rel in incoming[node]:
                start = max(start, self._forward_bound(rel, es, ef, duration))
            es[node], ef[node] = start, start + duration

        project_duration = max(ef.values(), default=0)

        ls: Dict[str, int] = {}
        lf: Dict[str, int] = {}
        for node in reversed(order):
            duration = nodes[node].duration
            finish = project_duration
            for rel in outgoing[node]:
                finish = min(finish, self._backward_bound(rel, ls, lf, duration))
            lf[node], ls[node] = finish, finish - duration

        times = {
            node: NodeTimes(es[node], ef[node], ls[node], lf[node],
                            total_float=ls[node] - es[node],
                            free_float=self._free_float(node, outgoing[node], es, ef, project_duration))
            for node in order
        }
        driving = [rel for rel in relations
                   if self._forward_bound(rel, es, ef, nodes[rel.successor].duration) == es[rel.successor]]
        return CpmResult(times=times, project_duration=project_duration, order=order, driving=driving)

    @staticmethod
    def _forward_bound(rel: Precedence, es: Mapping[str, int], ef: Mapping[str, int], successor_duration: int) -> int:
        p = rel.predecessor
        return {
            DependencyType.FS: ef[p] + rel.lag,
            DependencyType.SS: es[p] + rel.lag,
            DependencyType.FF: ef[p] + rel.lag - successor_duration,
            DependencyType.SF: es[p] + rel.lag - successor_duration,
        }[rel.type]

    @staticmethod
    def _backward_bound(rel: Precedence, ls: Mapping[str, int], lf: Mapping[str, int], predecessor_duration: int) -> int:
        s = rel.successor
        return {
            DependencyType.FS: ls[s] - rel.lag,
            DependencyType.SS: ls[s] - rel.lag + predecessor_duration,
            DependencyType.FF: lf[s] - rel.lag,
            DependencyType.SF: lf[s] - rel.lag + predecessor_duration,
        }[rel.type]

    @staticmethod
    def _free_float(node: str, outgoing: Sequence[Precedence], es: Mapping[str, int], ef: Mapping[str, int],
                    project_duration: int) -> int:
        """Delay allowed without delaying any successor's early dates."""
        if not outgoing:
            return project_duration - ef[node]
        slacks = []
        for rel in outgoing:
            s = rel.successor
            slacks.append({
                DependencyType.FS: es[s] - rel.lag - ef[node],
                DependencyType.SS: es[s] - rel.lag - es[node],
                DependencyType.FF: ef[s] - rel.lag - ef[node],
                DependencyType.SF: ef[s] - rel.lag - es[node],
            }[rel.type])
        return max(0, min(slacks))
