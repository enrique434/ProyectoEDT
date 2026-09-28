from datetime import date

import pytest

from app.domain.entities.project import ItemFields, Project
from app.domain.entities.resources import Member
from app.domain.errors import (
    CycleError,
    DependencyConflictError,
    HierarchyRuleError,
    ValidationError,
)
from app.domain.value_objects.duration import TimeUnit
from app.domain.value_objects.enums import (
    DeletionStrategy,
    DependencyType,
    ItemStatus,
    Methodology,
    WorkItemKind as K,
)
from app.domain.value_objects.pert import PertEstimate


def project(methodology=Methodology.HYBRID):
    return Project.create("Demo", methodology, date(2026, 9, 7))


def test_create_seeds_roles_for_methodology():
    assert "Scrum Master" in {r.name for r in project(Methodology.AGILE).roles.values()}
    assert "Project Manager" in {r.name for r in project(Methodology.TRADITIONAL).roles.values()}


@pytest.mark.parametrize("methodology,parent,child,allowed", [
    (Methodology.TRADITIONAL, None, K.PHASE, True),
    (Methodology.TRADITIONAL, None, K.SPRINT, False),
    (Methodology.AGILE, None, K.SPRINT, True),
    (Methodology.AGILE, None, K.PHASE, False),
    (Methodology.HYBRID, K.PHASE, K.SPRINT, True),
    (Methodology.HYBRID, K.PHASE, K.TASK, True),
    (Methodology.HYBRID, None, K.TASK, False),
])
def test_structure_rules_per_methodology(methodology, parent, child, allowed):
    p = project(methodology)
    parent_id = p.add_item(parent, "Contenedor").id if parent else None
    if allowed:
        assert p.add_item(child, "Hijo", parent_id).kind == child
    else:
        with pytest.raises(HierarchyRuleError):
            p.add_item(child, "Hijo", parent_id)


def test_subtask_cannot_have_children():
    p = project()
    phase = p.add_item(K.PHASE, "Fase")
    task = p.add_item(K.TASK, "Tarea", phase.id)
    sub = p.add_item(K.SUBTASK, "Sub", task.id)
    with pytest.raises(HierarchyRuleError):
        p.add_item(K.SUBTASK, "Sub-sub", sub.id)


def test_wbs_codes_follow_outline():
    p = project()
    a = p.add_item(K.PHASE, "Análisis")
    p.add_item(K.TASK, "Requisitos", a.id)
    b = p.add_item(K.PHASE, "Desarrollo")
    s = p.add_item(K.SPRINT, "Sprint 1", b.id)
    p.add_item(K.TASK, "Login", s.id)
    codes = {item.name: code for item, code, _ in p.wbs_outline()}
    assert codes == {"Análisis": "1", "Requisitos": "1.1", "Desarrollo": "2", "Sprint 1": "2.1", "Login": "2.1.1"}


def test_milestone_has_zero_duration():
    p = project()
    milestone = p.add_item(K.MILESTONE, "Entrega", fields=ItemFields(duration_value=3))
    assert milestone.duration_minutes == 0


def test_default_durations_come_from_settings():
    p = project()
    phase = p.add_item(K.PHASE, "F")
    assert p.add_item(K.TASK, "T", phase.id).duration_minutes == p.settings.default_task_duration_minutes
    assert p.add_item(K.SPRINT, "S", phase.id).duration_minutes == p.settings.default_sprint_duration_minutes


def _three_tasks(p):
    phase = p.add_item(K.PHASE, "F")
    return [p.add_item(K.TASK, n, phase.id) for n in "ABC"]


def test_self_dependency_is_rejected():
    p = project()
    a, _, _ = _three_tasks(p)
    with pytest.raises(ValidationError):
        p.add_dependency(a.id, a.id)


def test_cycle_is_rejected_and_not_stored():
    p = project()
    a, b, c = _three_tasks(p)
    p.add_dependency(a.id, b.id)
    p.add_dependency(b.id, c.id)
    with pytest.raises(CycleError) as error:
        p.add_dependency(c.id, a.id)
    assert "A" in str(error.value) and len(p.dependencies) == 2


def test_duplicate_dependency_is_rejected():
    p = project()
    a, b, _ = _three_tasks(p)
    p.add_dependency(a.id, b.id)
    with pytest.raises(ValidationError):
        p.add_dependency(a.id, b.id, DependencyType.SS)


def test_dependency_between_item_and_its_container_is_rejected():
    p = project()
    phase = p.add_item(K.PHASE, "F")
    task = p.add_item(K.TASK, "T", phase.id)
    with pytest.raises(ValidationError):
        p.add_dependency(phase.id, task.id)


def test_cycle_through_hierarchy_is_detected():
    """Sprint 1 -> Sprint 2 and a task of Sprint 2 -> a task of Sprint 1 is circular."""
    p = project()
    phase = p.add_item(K.PHASE, "Desarrollo")
    s1, s2 = p.add_item(K.SPRINT, "S1", phase.id), p.add_item(K.SPRINT, "S2", phase.id)
    t1, t2 = p.add_item(K.TASK, "T1", s1.id), p.add_item(K.TASK, "T2", s2.id)
    p.add_dependency(s1.id, s2.id)
    with pytest.raises(CycleError):
        p.add_dependency(t2.id, t1.id)


def test_lag_is_converted_to_minutes():
    p = project()
    a, b, _ = _three_tasks(p)
    dependency = p.add_dependency(a.id, b.id, DependencyType.FS, 2, TimeUnit.DAY)
    assert dependency.lag_minutes == 960


def test_remove_with_dependencies_requires_strategy():
    p = project()
    a, b, c = _three_tasks(p)
    p.add_dependency(a.id, b.id)
    p.add_dependency(b.id, c.id)
    with pytest.raises(DependencyConflictError) as error:
        p.remove_item(b.id)
    assert len(error.value.dependencies) == 2


def test_remove_with_bridge_reconnects_neighbours():
    p = project()
    a, b, c = _three_tasks(p)
    p.add_dependency(a.id, b.id)
    p.add_dependency(b.id, c.id)
    p.remove_item(b.id, DeletionStrategy.BRIDGE)
    assert [(d.predecessor_id, d.successor_id) for d in p.dependencies.values()] == [(a.id, c.id)]


def test_remove_summary_deletes_subtree_and_assignments():
    p = project()
    phase = p.add_item(K.PHASE, "F")
    task = p.add_item(K.TASK, "T", phase.id)
    p.add_item(K.SUBTASK, "S", task.id)
    member = p.add_member(Member(id="", name="Ana"))
    p.set_assignments(task.id, [(member.id, 100)])
    p.remove_item(phase.id, DeletionStrategy.REMOVE)
    assert not p.items and not p.assignments


def test_move_item_validates_rules_and_reorders():
    p = project()
    f1, f2 = p.add_item(K.PHASE, "F1"), p.add_item(K.PHASE, "F2")
    t = p.add_item(K.TASK, "T", f1.id)
    p.move_item(t.id, f2.id)
    assert t.parent_id == f2.id
    with pytest.raises(HierarchyRuleError):
        p.move_item(f1.id, f2.id)  # a phase cannot be inside a phase


def test_move_into_own_descendant_is_rejected():
    p = project()
    phase = p.add_item(K.PHASE, "F")
    sprint = p.add_item(K.SPRINT, "S", phase.id)
    with pytest.raises(HierarchyRuleError):
        p.move_item(phase.id, sprint.id)


def test_change_methodology_validates_existing_structure():
    p = project(Methodology.HYBRID)
    phase = p.add_item(K.PHASE, "F")
    p.add_item(K.SPRINT, "S", phase.id)
    with pytest.raises(HierarchyRuleError):
        p.change_methodology(Methodology.TRADITIONAL)


def test_progress_and_status_rules():
    p = project()
    task = _three_tasks(p)[0]
    task.set_progress(100)
    assert task.status == ItemStatus.COMPLETED
    task.set_status(ItemStatus.IN_PROGRESS)
    assert task.progress == 99
    with pytest.raises(ValidationError):
        task.set_progress(120)


def test_pert_sets_duration_to_expected_time():
    p = project()
    task = _three_tasks(p)[0]
    task.apply_pert(PertEstimate(4, 6, 10), TimeUnit.DAY, p.converter)
    assert task.duration_minutes == round(38 / 6 * 480)


def test_changing_day_length_preserves_durations_in_days():
    from dataclasses import replace
    p = project()
    task = _three_tasks(p)[0]
    task.set_manual_duration(2, TimeUnit.DAY, p.converter)
    p.update_settings(replace(p.settings, minutes_per_day=360))
    assert task.duration_minutes == 720


def test_assignments_reject_duplicates():
    p = project()
    task = _three_tasks(p)[0]
    member = p.add_member(Member(id="", name="Ana"))
    with pytest.raises(ValidationError):
        p.set_assignments(task.id, [(member.id, 50), (member.id, 50)])
