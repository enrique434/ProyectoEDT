"""SQLAlchemy implementation of the ``ProjectRepository`` and ``UnitOfWork`` ports."""
from __future__ import annotations

from typing import Any, Callable, Dict, Iterable, List

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.application.ports import ProjectListing, ProjectRepository, UnitOfWork
from app.domain.entities.project import Project
from app.domain.errors import NotFoundError
from app.domain.value_objects.enums import Methodology
from app.infrastructure.persistence import mappers
from app.infrastructure.persistence.models import (
    AssignmentModel,
    CalendarExceptionModel,
    DependencyModel,
    MemberModel,
    ProjectModel,
    RoleModel,
    WorkItemModel,
)


class SqlAlchemyProjectRepository(ProjectRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, project_id: str) -> Project:
        return mappers.project_to_domain(self._get_model(project_id))

    def list(self) -> List[ProjectListing]:
        item_count = (select(WorkItemModel.project_id, func.count(WorkItemModel.id).label("n"))
                      .group_by(WorkItemModel.project_id).subquery())
        rows = self._session.execute(
            select(ProjectModel.id, ProjectModel.name, ProjectModel.description, ProjectModel.methodology,
                   ProjectModel.start_date, ProjectModel.target_date, ProjectModel.schedule_finish,
                   func.coalesce(item_count.c.n, 0), ProjectModel.updated_at)
            .outerjoin(item_count, item_count.c.project_id == ProjectModel.id)
            .order_by(ProjectModel.updated_at.desc()))
        return [ProjectListing(r[0], r[1], r[2], Methodology(r[3]), r[4], r[5], r[6], r[7], r[8]) for r in rows]

    def add(self, project: Project) -> None:
        model = ProjectModel()
        mappers.update_project_model(project, model)
        self._session.add(model)
        self._session.flush()
        self._sync(project, model)

    def save(self, project: Project) -> None:
        model = self._get_model(project.id)
        mappers.update_project_model(project, model)
        self._sync(project, model)

    def delete(self, project_id: str) -> None:
        exists = self._session.scalar(select(ProjectModel.id).where(ProjectModel.id == project_id))
        if exists is None:
            raise NotFoundError("Proyecto", project_id)
        # A single DELETE lets the database cascade to every child row (ON DELETE CASCADE).
        self._session.execute(delete(ProjectModel).where(ProjectModel.id == project_id))

    # --------------------------------------------------------------- helpers
    def _get_model(self, project_id: str) -> ProjectModel:
        model = self._session.get(ProjectModel, project_id)
        if model is None:
            raise NotFoundError("Proyecto", project_id)
        return model

    def _sync(self, project: Project, model: ProjectModel) -> None:
        """Brings the rows in line with the aggregate respecting foreign-key order."""
        pid = project.id
        # 1. deletions, dependents first
        self._delete_missing(model.assignments, project.assignments)
        self._delete_missing(model.dependencies, project.dependencies)
        self._delete_missing_items(model.items, project.items)
        self._delete_missing(model.members, project.members)
        self._delete_missing(model.roles, project.roles)
        exceptions = {e.day: e for e in project.calendar.exceptions.values()}
        for row in list(model.calendar_exceptions):
            if row.day not in exceptions:
                self._session.delete(row)
        self._session.flush()
        # 2. upserts, referenced rows first
        self._upsert(RoleModel, model.roles, project.roles.values(), pid)
        self._upsert(MemberModel, model.members, project.members.values(), pid)
        outline = [item for item, _, _ in project.wbs_outline()]  # parents before children
        self._upsert(WorkItemModel, model.items, outline, pid)
        self._upsert(DependencyModel, model.dependencies, project.dependencies.values(), pid)
        self._upsert(AssignmentModel, model.assignments, project.assignments.values(), pid)
        existing_days = {row.day: row for row in model.calendar_exceptions}
        for day, exception in exceptions.items():
            fields = mappers.exception_fields(exception)
            if day in existing_days:
                self._assign(existing_days[day], fields)
            else:
                self._session.add(CalendarExceptionModel(project_id=pid, **fields))
        self._session.flush()

    def _delete_missing(self, rows: Iterable[Any], keep: Dict[str, Any]) -> None:
        for row in list(rows):
            if row.id not in keep:
                self._session.delete(row)
        self._session.flush()

    def _delete_missing_items(self, rows: Iterable[WorkItemModel], keep: Dict[str, Any]) -> None:
        """Deletes removed WBS rows deepest-first so the self-referencing FK is never violated."""
        by_id = {row.id: row for row in rows}
        doomed = [row for row in by_id.values() if row.id not in keep]

        def depth(row: WorkItemModel) -> int:
            level, parent = 0, row.parent_id
            while parent is not None and parent in by_id:
                level, parent = level + 1, by_id[parent].parent_id
            return level

        for row in sorted(doomed, key=depth, reverse=True):
            self._session.delete(row)
            self._session.flush()

    def _upsert(self, model_class: type, rows: Iterable[Any], entities: Iterable[Any], project_id: str) -> None:
        build_fields: Callable[[Any], Dict] = mappers.MODEL_FIELD_BUILDERS[model_class]
        existing = {row.id: row for row in rows}
        new_rows, updates = [], []
        for entity in entities:
            fields = build_fields(entity)
            if entity.id in existing:
                updates.append((existing[entity.id], fields))
            else:
                new_rows.append(model_class(project_id=project_id, **fields))
        for row in new_rows:  # inserts first: updated rows may reference new ones
            self._session.add(row)
            self._session.flush()
        for row, fields in updates:
            self._assign(row, fields)
        self._session.flush()

    @staticmethod
    def _assign(row: Any, fields: Dict) -> None:
        for key, value in fields.items():
            if getattr(row, key) != value:
                setattr(row, key, value)


class SqlAlchemyUnitOfWork(UnitOfWork):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def __enter__(self) -> "SqlAlchemyUnitOfWork":
        self._session = self._session_factory()
        self.projects = SqlAlchemyProjectRepository(self._session)
        return self

    def __exit__(self, *exc_info) -> None:
        self.rollback()
        self._session.close()

    def commit(self) -> None:
        self._session.commit()

    def rollback(self) -> None:
        self._session.rollback()
