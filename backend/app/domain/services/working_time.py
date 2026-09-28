"""Calendar engine: translates working-minute offsets to real dates and back.

The planning timeline is a continuous axis of *working minutes* counted from the first
working moment of the project start date. Non-working time simply does not exist on that
axis, so holidays and weekends never consume duration (RN-16).
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
from datetime import date, datetime, time, timedelta
from typing import List

from app.domain.entities.calendar import WorkCalendar
from app.domain.errors import ValidationError

MAX_CONSECUTIVE_IDLE_DAYS = 3660


class WorkingTimeCalculator:
    def __init__(self, calendar: WorkCalendar, origin: date) -> None:
        self._calendar = calendar
        self._origin = origin
        # Cache of working days only: dates, minutes worked before that day, minutes of the day.
        self._days: List[date] = []
        self._cumulative: List[int] = []
        self._minutes: List[int] = []
        self._next_day = origin

    @property
    def origin(self) -> date:
        return self._origin

    # ------------------------------------------------------------------ cache
    def _total(self) -> int:
        return self._cumulative[-1] + self._minutes[-1] if self._days else 0

    def _extend_one_working_day(self) -> None:
        for _ in range(MAX_CONSECUTIVE_IDLE_DAYS):
            day = self._next_day
            self._next_day = day + timedelta(days=1)
            minutes = self._calendar.working_minutes_on(day)
            if minutes > 0:
                self._cumulative.append(self._total())
                self._days.append(day)
                self._minutes.append(minutes)
                return
        raise ValidationError("El calendario no tiene tiempo laborable suficiente para planificar")

    def _ensure_offset(self, offset: int) -> None:
        while not self._days or self._total() <= offset:
            self._extend_one_working_day()

    def _ensure_date(self, day: date) -> None:
        while self._next_day <= day:
            if self._calendar.working_minutes_on(self._next_day) > 0:
                self._extend_one_working_day()
            else:
                self._next_day += timedelta(days=1)

    # ------------------------------------------------------------ conversions
    def to_datetime(self, offset: int, at_finish: bool = False) -> datetime:
        """Converts a working-minute offset to a datetime.

        ``at_finish`` resolves boundaries: offset 480 on an 8 h calendar is "day 1 17:00" as a
        finish, but "day 2 08:00" as a start.
        """
        offset = max(0, offset)
        at_finish = at_finish and offset > 0
        self._ensure_offset(offset)
        index = (bisect_left(self._cumulative, offset) if at_finish else bisect_right(self._cumulative, offset)) - 1
        day = self._days[index]
        remaining = offset - self._cumulative[index]
        for interval in self._calendar.intervals_for(day):
            fits = remaining <= interval.minutes if at_finish else remaining < interval.minutes
            if fits:
                return datetime.combine(day, interval.start) + timedelta(minutes=remaining)
            remaining -= interval.minutes
        raise AssertionError("Offset fuera del día calculado")  # pragma: no cover

    def to_offset(self, moment: datetime) -> int:
        """Working minutes elapsed between the origin and ``moment`` (non-working time is skipped)."""
        day = moment.date()
        if day < self._origin:
            return 0
        self._ensure_date(day)
        index = bisect_left(self._days, day)
        offset = self._cumulative[index] if index < len(self._days) else self._total()
        if index < len(self._days) and self._days[index] == day:
            minute_of_day = moment.hour * 60 + moment.minute
            for interval in self._calendar.intervals_for(day):
                start = interval.start_minute
                offset += max(0, min(minute_of_day, start + interval.minutes) - start)
        return offset

    def start_of_day_offset(self, day: date) -> int:
        return self.to_offset(datetime.combine(day, time(0, 0)))

    def end_of_day_offset(self, day: date) -> int:
        return self.start_of_day_offset(day + timedelta(days=1))

    def working_days_between(self, start_offset: int, end_offset: int):
        """Yields (date, overlap_minutes) of each working day overlapping [start, end)."""
        if end_offset <= start_offset:
            return
        self._ensure_offset(end_offset)
        index = bisect_right(self._cumulative, start_offset) - 1
        while index < len(self._days) and self._cumulative[index] < end_offset:
            day_start = self._cumulative[index]
            day_end = day_start + self._minutes[index]
            overlap = min(day_end, end_offset) - max(day_start, start_offset)
            if overlap > 0:
                yield self._days[index], overlap
            index += 1
