"""Planning engine: orchestrates calendar + network + CPM + PERT (RF-26..RF-32, RF-39).

Runs after every relevant change (RN-23, RN-24) and writes the calculated values into the
project, keeping them separated from the manual data typed by the user (RN-27).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Dict, List, Optional

from app.domain.entities.project import Project, ScheduleSummary
from app.domain.entities.work_item import ScheduleResult, WorkItem
from app.domain.services.cpm import CpmEngine, CpmResult
from app.domain.services.network import SchedulingNetwork, SchedulingNetworkBuilder, children_index
from app.domain.services.working_time import WorkingTimeCalculator
from app.domain.value_objects.enums import ItemStatus, WorkItemKind


def calculator_for(project: Project) -> WorkingTimeCalculator:
    return WorkingTimeCalculator(project.calendar, project.start_date)


@dataclass
class _Rollup:
    weighted_progress: float = 0.0
    weight: int = 0
    plain_progress: int = 0
    count: int = 0
    started: bool = False
    completed: bool = True


class ProjectScheduler:
    def __init__(self, engine: Optional[CpmEngine] = None, clock: Callable[[], datetime] = datetime.now) -> None:
        self._engine = engine or CpmEngine()
        self._clock = clock

    def schedule(self, project: Project) -> ScheduleSummary:
        calculator = calculator_for(project)

        def resolve(day, at_end_of_day: bool) -> int:
            return calculator.end_of_day_offset(day) if at_end_of_day else calculator.start_of_day_offset(day)

        network = SchedulingNetworkBuilder(project.items, project.dependencies.values(), resolve).build()
        result = self._engine.compute(network.activities.values(), network.precedences)

        self._apply_item_results(project, network, result, calculator)
        self._rollup_progress(project)

        duration = result.project_duration
        std_dev = self._critical_std_dev(project, network, result)
        summary = ScheduleSummary(
            start=calculator.to_datetime(0),
            finish=calculator.to_datetime(duration, at_finish=True),
            duration_minutes=duration,
            critical_item_ids=[item.id for item in sorted(
                (i for i in project.items.values() if not project.is_summary(i.id) and i.schedule.is_critical),
                key=lambda i: (i.schedule.early_start, i.schedule.early_finish))],
            pert_std_dev_minutes=std_dev,
            target_probability=self._target_probability(project, calculator, duration, std_dev),
            warnings=self._warnings(project, calculator, duration),
            calculated_at=self._clock(),
        )
        project.schedule = summary
        return summary

    # -------------------------------------------------------------- results
    def _apply_item_results(self, project: Project, network: SchedulingNetwork, result: CpmResult,
                            calculator: WorkingTimeCalculator) -> None:
        index = children_index(project.items.values())
        for item, _, _ in reversed(project.wbs_outline()):  # children before parents
            start = result.times[network.start_node[item.id]]
            finish = result.times[network.finish_node[item.id]]
            children = index.get(item.id, [])
            if children:  # a summary is critical through a child or through its own timebox
                total_float = min([start.total_float, finish.total_float]
                                  + [child.schedule.total_float for child in children])
                is_critical = total_float <= 0 or any(child.schedule.is_critical for child in children)
            else:
                total_float, is_critical = start.total_float, start.is_critical
            es, ef, ls = start.es, finish.ef, start.ls
            if children and item.kind != WorkItemKind.SPRINT:
                # A plain container spans exactly its children; a sprint keeps its timebox start.
                es = min(child.schedule.early_start for child in children)
                ls = min(child.schedule.late_start for child in children)
            if ef == es:
                start_dt = finish_dt = calculator.to_datetime(es, at_finish=True)
            else:
                start_dt, finish_dt = calculator.to_datetime(es), calculator.to_datetime(ef, at_finish=True)
            item.schedule = ScheduleResult(
                early_start=es, early_finish=ef, late_start=ls, late_finish=finish.lf,
                total_float=total_float, free_float=finish.free_float, is_critical=is_critical,
                start=start_dt, finish=finish_dt)

    @staticmethod
    def _rollup_progress(project: Project) -> None:
        """Summary progress = duration-weighted progress of its children; status is derived."""
        index = children_index(project.items.values())

        def visit(item: WorkItem) -> _Rollup:
            children = index.get(item.id, [])
            if not children:
                done = item.status == ItemStatus.COMPLETED
                return _Rollup(item.progress * item.scheduled_minutes, item.scheduled_minutes, item.progress, 1,
                               started=item.progress > 0 or item.status != ItemStatus.NOT_STARTED, completed=done)
            total = _Rollup()
            for child in children:
                part = visit(child)
                total.weighted_progress += part.weighted_progress
                total.weight += part.weight
                total.plain_progress += part.plain_progress
                total.count += part.count
                total.started = total.started or part.started
                total.completed = total.completed and part.completed
            progress = (total.weighted_progress / total.weight) if total.weight else total.plain_progress / total.count
            item.progress = 100 if total.completed else min(99, round(progress))
            item.status = (ItemStatus.COMPLETED if total.completed
                           else ItemStatus.IN_PROGRESS if total.started else ItemStatus.NOT_STARTED)
            return total

        for root in index.get(None, []):
            visit(root)

    # ------------------------------------------------------------------ PERT
    @staticmethod
    def _critical_std_dev(project: Project, network: SchedulingNetwork, result: CpmResult) -> float:
        """σ of the critical chain with the largest variance (driving relations only)."""
        variance: Dict[str, float] = {}
        predecessors: Dict[str, List[str]] = {}
        for relation in result.driving:
            predecessors.setdefault(relation.successor, []).append(relation.predecessor)
        best = 0.0
        for node in result.order:
            times = result.times[node]
            if not times.is_critical:
                continue
            item = project.items[network.owner[node]]
            own = item.pert_variance_minutes(project.converter) if network.activities[node].duration else 0.0
            upstream = [variance[p] for p in predecessors.get(node, []) if p in variance]
            variance[node] = own + max(upstream, default=0.0)
            if times.ef == result.project_duration:
                best = max(best, variance[node])
        return math.sqrt(best)

    @staticmethod
    def _target_probability(project: Project, calculator: WorkingTimeCalculator, duration: int,
                            std_dev: float) -> Optional[float]:
        """P(project finishes by the target date) assuming a normal distribution (PERT)."""
        if project.target_date is None:
            return None
        target = calculator.end_of_day_offset(project.target_date)
        if std_dev == 0:
            return 1.0 if duration <= target else 0.0
        z = (target - duration) / std_dev
        return 0.5 * (1 + math.erf(z / math.sqrt(2)))

    # -------------------------------------------------------------- warnings
    @staticmethod
    def _warnings(project: Project, calculator: WorkingTimeCalculator, duration: int) -> List[str]:
        warnings: List[str] = []
        if project.target_date is not None and duration > calculator.end_of_day_offset(project.target_date):
            finish = calculator.to_datetime(duration, at_finish=True)
            warnings.append(f"El fin calculado ({finish:%d/%m/%Y}) supera la fecha objetivo "
                            f"({project.target_date:%d/%m/%Y}).")
        for item in project.items.values():
            summary = project.is_summary(item.id)
            if item.kind == WorkItemKind.SPRINT and summary and item.scheduled_minutes > 0:
                overflow = item.schedule.early_finish - item.schedule.early_start - item.scheduled_minutes
                if overflow > 0:
                    warnings.append(f"El sprint '{item.name}' excede su timebox en "
                                    f"{overflow / project.converter.minutes_per_day:.1f} día(s).")
            if not summary and not item.is_milestone and item.duration_minutes == 0 \
                    and item.kind != WorkItemKind.PHASE:
                warnings.append(f"'{item.name}' no tiene duración.")
        inactive = {m.id for m in project.members.values() if not m.active}
        for assignment in project.assignments.values():
            if assignment.member_id in inactive:
                warnings.append(f"'{project.members[assignment.member_id].name}' está inactivo y tiene asignada "
                                f"'{project.items[assignment.work_item_id].name}'.")
        return warnings
