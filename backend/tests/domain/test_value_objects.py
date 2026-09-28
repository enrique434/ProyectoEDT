import pytest

from app.domain.errors import ValidationError
from app.domain.value_objects.duration import DurationConverter, TimeUnit
from app.domain.value_objects.pert import PertEstimate


def test_pert_expected_time_matches_formula():
    estimate = PertEstimate(4, 6, 10)
    assert estimate.expected == pytest.approx(6.3333, rel=1e-3)
    assert estimate.standard_deviation == pytest.approx(1.0)
    assert estimate.variance == pytest.approx(1.0)


@pytest.mark.parametrize("o,m,p", [(5, 4, 10), (1, 8, 6), (-1, 2, 3)])
def test_pert_rejects_invalid_estimates(o, m, p):
    with pytest.raises(ValidationError):
        PertEstimate(o, m, p)


def test_converter_uses_working_minutes():
    converter = DurationConverter(minutes_per_day=480, days_per_week=5, days_per_month=20)
    assert converter.to_minutes(1, TimeUnit.HOUR) == 60
    assert converter.to_minutes(1, TimeUnit.DAY) == 480
    assert converter.to_minutes(1, TimeUnit.WEEK) == 2400
    assert converter.to_minutes(1, TimeUnit.MONTH) == 9600
    assert converter.from_minutes(1200, TimeUnit.DAY) == 2.5


def test_converter_rejects_invalid_parameters():
    with pytest.raises(ValidationError):
        DurationConverter(minutes_per_day=0)
