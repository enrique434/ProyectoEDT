import pytest

from app.domain.errors import CycleError
from app.domain.services.cpm import Activity, CpmEngine, Precedence
from app.domain.services.graph import topological_order
from app.domain.value_objects.enums import DependencyType as T


def compute(durations, relations):
    activities = [Activity(name, duration) for name, duration in durations.items()]
    return CpmEngine().compute(activities, [Precedence(*r) for r in relations])


def test_textbook_example_from_requirements():
    """A[5] -> B[3] / C[7] -> D[4]: A->C->D = 16 is the critical path."""
    result = compute({"A": 5, "B": 3, "C": 7, "D": 4},
                     [("A", "B"), ("A", "C"), ("B", "D"), ("C", "D")])
    t = result.times
    assert result.project_duration == 16
    assert (t["C"].es, t["C"].ef, t["C"].ls, t["C"].lf) == (5, 12, 5, 12)
    assert (t["B"].es, t["B"].ef, t["B"].ls, t["B"].lf) == (5, 8, 9, 12)
    assert t["B"].total_float == 4 and t["B"].free_float == 4
    assert [n for n in "ABCD" if t[n].is_critical] == ["A", "C", "D"]


def test_lag_and_lead_on_finish_to_start():
    lag = compute({"A": 5, "B": 3}, [("A", "B", T.FS, 2)])
    lead = compute({"A": 5, "B": 3}, [("A", "B", T.FS, -2)])
    assert lag.times["B"].es == 7
    assert lead.times["B"].es == 3


def test_start_to_start():
    result = compute({"A": 10, "B": 4}, [("A", "B", T.SS, 3)])
    assert result.times["B"].es == 3
    assert result.times["B"].total_float == 3


def test_finish_to_finish():
    result = compute({"A": 10, "B": 4}, [("A", "B", T.FF, 0)])
    assert (result.times["B"].es, result.times["B"].ef) == (6, 10)
    assert result.times["B"].is_critical


def test_start_to_finish():
    result = compute({"A": 5, "B": 3}, [("A", "B", T.SF, 4)])
    assert result.times["B"].ef == 4
    assert result.times["B"].es == 1


def test_early_start_never_before_project_start():
    result = compute({"A": 2, "B": 8}, [("A", "B", T.FF, 0)])
    assert result.times["B"].es == 0


def test_earliest_start_constraint_is_respected():
    result = CpmEngine().compute([Activity("A", 5), Activity("B", 3, earliest_start=20)], [])
    assert result.times["B"].es == 20
    assert result.project_duration == 23
    assert result.times["A"].total_float == 18


def test_parallel_branches_without_dependencies_start_together():
    result = compute({"S1": 10, "S2": 10, "S3": 10}, [("S1", "S2"), ("S1", "S3")])
    assert result.times["S2"].es == result.times["S3"].es == 10


def test_cycle_is_detected_with_path():
    with pytest.raises(CycleError) as error:
        topological_order(["A", "B", "C"], [("A", "B"), ("B", "C"), ("C", "A")])
    cycle = error.value.cycle
    assert cycle[0] == cycle[-1] and set(cycle) == {"A", "B", "C"}
