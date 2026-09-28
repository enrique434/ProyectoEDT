"""SQLAlchemy ORM models (persistence representation, separate from the domain entities)."""
from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

ID = String(36)


class Base(DeclarativeBase):
    pass


def _children(model: str, order_by: Optional[str] = None):
    return relationship(model, cascade="all, delete-orphan", passive_deletes=True, lazy="selectin",
                        order_by=order_by)


class ProjectModel(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    name: Mapped[str] = mapped_column(String(150))
    description: Mapped[str] = mapped_column(Text, default="")
    methodology: Mapped[str] = mapped_column(String(20))
    start_date: Mapped[date] = mapped_column(Date)
    target_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    # settings
    default_time_unit: Mapped[str] = mapped_column(String(10))
    default_task_duration_minutes: Mapped[int] = mapped_column(Integer)
    default_sprint_duration_minutes: Mapped[int] = mapped_column(Integer)
    minutes_per_day: Mapped[int] = mapped_column(Integer)
    days_per_week: Mapped[int] = mapped_column(Integer)
    days_per_month: Mapped[int] = mapped_column(Integer)
    # calendar: {"0": [["08:00", "12:00"], ...], ...}
    calendar_week: Mapped[dict] = mapped_column(JSON)
    # last calculated schedule (derived data)
    schedule_start: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    schedule_finish: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    schedule_duration_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    schedule_std_dev_minutes: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    schedule_target_probability: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    schedule_critical_ids: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    schedule_warnings: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    schedule_calculated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    updated_at: Mapped[datetime] = mapped_column(DateTime)

    calendar_exceptions: Mapped[List["CalendarExceptionModel"]] = _children("CalendarExceptionModel",
                                                                             "CalendarExceptionModel.day")
    roles: Mapped[List["RoleModel"]] = _children("RoleModel")
    members: Mapped[List["MemberModel"]] = _children("MemberModel")
    items: Mapped[List["WorkItemModel"]] = _children("WorkItemModel", "WorkItemModel.sort_order")
    dependencies: Mapped[List["DependencyModel"]] = _children("DependencyModel")
    assignments: Mapped[List["AssignmentModel"]] = _children("AssignmentModel")


def _project_fk() -> Mapped[str]:
    return mapped_column(ID, ForeignKey("projects.id", ondelete="CASCADE"), index=True)


class CalendarExceptionModel(Base):
    __tablename__ = "calendar_exceptions"

    project_id: Mapped[str] = mapped_column(ID, ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    intervals: Mapped[list] = mapped_column(JSON, default=list)


class RoleModel(Base):
    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_role_name"),)

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    project_id: Mapped[str] = _project_fk()
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")


class MemberModel(Base):
    __tablename__ = "members"

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    project_id: Mapped[str] = _project_fk()
    role_id: Mapped[Optional[str]] = mapped_column(ID, ForeignKey("roles.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(200), default="")
    responsibility: Mapped[str] = mapped_column(Text, default="")
    hours_per_day: Mapped[float] = mapped_column(Float)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class WorkItemModel(Base):
    __tablename__ = "work_items"
    __table_args__ = (
        CheckConstraint("progress >= 0 AND progress <= 100", name="ck_item_progress"),
        CheckConstraint("duration_minutes >= 0", name="ck_item_duration"),
    )

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    project_id: Mapped[str] = _project_fk()
    parent_id: Mapped[Optional[str]] = mapped_column(ID, ForeignKey("work_items.id", ondelete="CASCADE"),
                                                     nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    objective: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=0)
    duration_unit: Mapped[str] = mapped_column(String(10))
    estimation_mode: Mapped[str] = mapped_column(String(10))
    pert_optimistic: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pert_most_likely: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pert_pessimistic: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    constraint_type: Mapped[str] = mapped_column(String(10))
    constraint_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20))
    priority: Mapped[str] = mapped_column(String(10))
    progress: Mapped[int] = mapped_column(Integer, default=0)
    # calculated values (RN-27: kept apart from the manual data above)
    early_start: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    early_finish: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    late_start: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    late_finish: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    total_float: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    free_float: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_critical: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    scheduled_start: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    scheduled_finish: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class DependencyModel(Base):
    __tablename__ = "dependencies"
    __table_args__ = (
        UniqueConstraint("predecessor_id", "successor_id", name="uq_dependency_pair"),
        CheckConstraint("predecessor_id <> successor_id", name="ck_dependency_not_self"),
    )

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    project_id: Mapped[str] = _project_fk()
    predecessor_id: Mapped[str] = mapped_column(ID, ForeignKey("work_items.id", ondelete="CASCADE"))
    successor_id: Mapped[str] = mapped_column(ID, ForeignKey("work_items.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(2))
    lag_minutes: Mapped[int] = mapped_column(Integer, default=0)
    lag_unit: Mapped[str] = mapped_column(String(10))


class AssignmentModel(Base):
    __tablename__ = "assignments"
    __table_args__ = (UniqueConstraint("work_item_id", "member_id", name="uq_assignment"),)

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    project_id: Mapped[str] = _project_fk()
    work_item_id: Mapped[str] = mapped_column(ID, ForeignKey("work_items.id", ondelete="CASCADE"))
    member_id: Mapped[str] = mapped_column(ID, ForeignKey("members.id", ondelete="CASCADE"))
    units: Mapped[int] = mapped_column(Integer, default=100)
