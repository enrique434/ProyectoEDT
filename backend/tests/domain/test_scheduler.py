from datetime import date, datetime

import pytest

from app.domain.entities.project import ItemFields, Project
from app.domain.entities.resources import Member
from app.domain.entities.work_item import ScheduleConstraint
from app.domain.services.resource_load import ResourceLoadAnalyzer
from app.domain.services.scheduler import ProjectScheduler
from app.domain.value_objects.duration import TimeUnit
from app.domain.value_objects.enums import ConstraintType, DependencyType, Methodology, WorkItemKind as K
from app.domain.value_objects.pert import PertEstimate

MONDAY = date(2026, 9, 7)


def days(n):
    return ItemFields(duration_value=n, duration_unit=TimeUnit.DAY)


def schedule(p):
    return ProjectScheduler(clock=lambda: datetime(2026, 1, 1)).schedule(p)


def test_textbook_network_on_calendar():
    p = Project.create("CPM", Methodology.TRADITIONAL, MONDAY)
    phase = p.add_item(K.PHASE, "Fase")
    a, b, c, d = (p.add_item(K.TASK, n, phase.id, days(v)) for n, v in zip("ABCD", (5, 3, 7, 4)))
    for pred, succ in ((a, b), (a, c), (b, d), (c, d)):
        p.add_dependency(pred.id, succ.id)
    summary = schedule(p)

    assert summary.duration_minutes == 16 * 480
    assert summary.critical_item_ids == [a.id, c.id, d.id]
    assert b.schedule.total_float == 4 * 480
    assert a.schedule.start == datetime(2026, 9, 7, 8, 0)
    assert a.schedule.finish == datetime(2026, 9, 11, 17, 0)  # Friday
    assert c.schedule.start == datetime(2026, 9, 14, 8, 0)  # next Monday: weekend skipped
    assert summary.finish == datetime(2026, 9, 28, 17, 0)
    # Phase dates are derived from children
    assert (phase.schedule.start, phase.schedule.finish) == (a.schedule.start, d.schedule.finish)
    assert phase.schedule.is_critical


def test_hybrid_sprints_run_in_parallel_unless_dependent():
    p = Project.create("Híbrido", Methodology.HYBRID, MONDAY)
    dev = p.add_item(K.PHASE, "Desarrollo")
    s1, s2, s3 = (p.add_item(K.SPRINT, f"Sprint {i}", dev.id) for i in (1, 2, 3))
    for sprint in (s1, s2, s3):
        p.add_item(K.TASK, f"Tarea {sprint.name}", sprint.id, days(3))
    p.add_dependency(s1.id, s2.id)
    schedule(p)

    assert s1.schedule.early_start == s3.schedule.early_start == 0  # parallel (RN-25)
    assert s2.schedule.early_start == s1.schedule.early_finish
    assert s1.schedule.early_finish == 10 * 480  # sprint timebox of 2 weeks


def test_phase_without_predecessors_spans_its_children():
    """A phase whose only content starts late must not appear to start at the project start."""
    p = Project.create("Rollup", Methodology.HYBRID, MONDAY)
    dev, tests = p.add_item(K.PHASE, "Desarrollo"), p.add_item(K.PHASE, "Pruebas")
    build = p.add_item(K.TASK, "Construir", dev.id, days(5))
    qa = p.add_item(K.TASK, "QA", tests.id, days(2))
    p.add_dependency(build.id, qa.id)
    schedule(p)
    assert tests.schedule.start == qa.schedule.start == datetime(2026, 9, 14, 8, 0)


def test_dependency_between_phases_moves_all_children():
    p = Project.create("Trad", Methodology.TRADITIONAL, MONDAY)
    analysis, design = p.add_item(K.PHASE, "Análisis"), p.add_item(K.PHASE, "Diseño")
    p.add_item(K.TASK, "Req", analysis.id, days(2))
    arch = p.add_item(K.TASK, "Arquitectura", design.id, days(1))
    p.add_dependency(analysis.id, design.id, DependencyType.FS, 1, TimeUnit.DAY)
    schedule(p)
    assert arch.schedule.early_start == 3 * 480


def test_snet_constraint_delays_start():
    p = Project.create("Restr", Methodology.TRADITIONAL, MONDAY)
    phase = p.add_item(K.PHASE, "F")
    task = p.add_item(K.TASK, "T", phase.id, days(1))
    task.set_constraint(ScheduleConstraint(ConstraintType.SNET, date(2026, 9, 9)))
    schedule(p)
    assert task.schedule.start == datetime(2026, 9, 9, 8, 0)


def test_milestone_after_task_is_placed_at_its_finish():
    p = Project.create("Hito", Methodology.TRADITIONAL, MONDAY)
    phase = p.add_item(K.PHASE, "F")
    task = p.add_item(K.TASK, "T", phase.id, days(1))
    milestone = p.add_item(K.MILESTONE, "Entrega", phase.id)
    p.add_dependency(task.id, milestone.id)
    schedule(p)
    assert milestone.schedule.start == milestone.schedule.finish == datetime(2026, 9, 7, 17, 0)


def test_summary_progress_is_weighted_by_duration():
    p = Project.create("Avance", Methodology.TRADITIONAL, MONDAY)
    phase = p.add_item(K.PHASE, "F")
    long_task, short_task = p.add_item(K.TASK, "L", phase.id, days(3)), p.add_item(K.TASK, "S", phase.id, days(1))
    long_task.set_progress(100)
    schedule(p)
    assert phase.progress == 75


def test_pert_probability_of_meeting_target():
    p = Project.create("PERT", Methodology.TRADITIONAL, MONDAY, target_date=date(2026, 9, 18))
    phase = p.add_item(K.PHASE, "F")
    task = p.add_item(K.TASK, "T", phase.id)
    task.apply_pert(PertEstimate(4, 6, 10), TimeUnit.DAY, p.converter)
    summary = schedule(p)
    assert summary.pert_std_dev_minutes == pytest.approx(480)
    assert summary.target_probability == pytest.approx(0.9998, abs=1e-3)  # ~3.67 σ margin


def test_warning_when_finish_exceeds_target():
    p = Project.create("Tarde", Methodology.TRADITIONAL, MONDAY, target_date=date(2026, 9, 8))
    phase = p.add_item(K.PHASE, "F")
    p.add_item(K.TASK, "T", phase.id, days(5))
    assert any("fecha objetivo" in w for w in schedule(p).warnings)


def test_resource_overallocation_is_detected():
    p = Project.create("Recursos", Methodology.TRADITIONAL, MONDAY)
    phase = p.add_item(K.PHASE, "F")
    a, b = p.add_item(K.TASK, "A", phase.id, days(2)), p.add_item(K.TASK, "B", phase.id, days(1))
    ana = p.add_member(Member(id="", name="Ana", hours_per_day=8))
    p.set_assignments(a.id, [(ana.id, 100)])
    p.set_assignments(b.id, [(ana.id, 50)])
    schedule(p)
    load = ResourceLoadAnalyzer().analyze(p)[0]
    assert [d.day for d in load.overallocated_days] == [MONDAY]
    assert load.total_minutes == 2 * 480 + 240
