from datetime import date, datetime, time

import pytest

from app.domain.entities.calendar import CalendarException, WorkCalendar, WorkInterval
from app.domain.errors import ValidationError
from app.domain.services.working_time import WorkingTimeCalculator

MONDAY = date(2026, 9, 7)


def calculator(calendar=None, origin=MONDAY):
    return WorkingTimeCalculator(calendar or WorkCalendar.standard(), origin)


def test_offset_zero_is_first_working_minute():
    assert calculator().to_datetime(0) == datetime(2026, 9, 7, 8, 0)


def test_lunch_break_is_skipped():
    calc = calculator()
    assert calc.to_datetime(240) == datetime(2026, 9, 7, 13, 0)
    assert calc.to_datetime(240, at_finish=True) == datetime(2026, 9, 7, 12, 0)


def test_day_boundary_differs_for_start_and_finish():
    calc = calculator()
    assert calc.to_datetime(480, at_finish=True) == datetime(2026, 9, 7, 17, 0)
    assert calc.to_datetime(480) == datetime(2026, 9, 8, 8, 0)


def test_weekend_does_not_consume_duration():
    # 5 working days starting Monday end Friday; the 6th starts next Monday.
    calc = calculator()
    assert calc.to_datetime(5 * 480, at_finish=True) == datetime(2026, 9, 11, 17, 0)
    assert calc.to_datetime(5 * 480) == datetime(2026, 9, 14, 8, 0)


def test_holiday_does_not_consume_duration():
    calendar = WorkCalendar.standard()
    calendar.set_exceptions([CalendarException(date(2026, 9, 8), "Feriado")])
    calc = calculator(calendar)
    assert calc.to_datetime(480) == datetime(2026, 9, 9, 8, 0)


def test_working_exception_on_saturday():
    calendar = WorkCalendar.standard()
    calendar.set_exceptions([CalendarException(date(2026, 9, 12), "Sábado laboral",
                                               (WorkInterval(time(9), time(13)),))])
    calc = calculator(calendar)
    assert calc.to_datetime(5 * 480) == datetime(2026, 9, 12, 9, 0)


def test_origin_on_weekend_starts_next_working_day():
    assert calculator(origin=date(2026, 9, 12)).to_datetime(0) == datetime(2026, 9, 14, 8, 0)


def test_to_offset_is_inverse_of_to_datetime():
    calc = calculator()
    for offset in (0, 30, 240, 479, 480, 2400, 3000):
        assert calc.to_offset(calc.to_datetime(offset)) == offset


def test_day_offsets():
    calc = calculator()
    assert calc.start_of_day_offset(date(2026, 9, 8)) == 480
    assert calc.end_of_day_offset(date(2026, 9, 8)) == 960
    assert calc.start_of_day_offset(date(2026, 9, 13)) == 2400  # Sunday
    assert calc.start_of_day_offset(date(2026, 1, 1)) == 0  # before origin


def test_working_days_between_reports_overlaps():
    days = list(calculator().working_days_between(240, 960 + 120))
    assert days == [(date(2026, 9, 7), 240), (date(2026, 9, 8), 480), (date(2026, 9, 9), 120)]


def test_calendar_requires_a_working_day():
    with pytest.raises(ValidationError):
        WorkCalendar(week={d: () for d in range(7)})


def test_overlapping_intervals_are_rejected():
    with pytest.raises(ValidationError):
        WorkCalendar(week={0: (WorkInterval(time(8), time(12)), WorkInterval(time(11), time(15)))})
