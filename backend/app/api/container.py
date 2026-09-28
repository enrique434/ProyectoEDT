"""Composition root: wires infrastructure implementations into the use cases (DIP)."""
from __future__ import annotations

from typing import Callable, Type, TypeVar

from fastapi import Request

from app.application.ports import UnitOfWork
from app.application.use_cases.base import UseCase
from app.config import Settings
from app.domain.services.scheduler import ProjectScheduler
from app.infrastructure.persistence.database import create_db_engine, create_session_factory
from app.infrastructure.persistence.repository import SqlAlchemyUnitOfWork

U = TypeVar("U", bound=UseCase)


class Container:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.engine = create_db_engine(settings.database_url)
        self.session_factory = create_session_factory(self.engine)
        self.scheduler = ProjectScheduler()

    def unit_of_work(self) -> UnitOfWork:
        return SqlAlchemyUnitOfWork(self.session_factory)

    def build(self, use_case: Type[U]) -> U:
        return use_case(self.unit_of_work, self.scheduler)


def provide(use_case: Type[U]) -> Callable[[Request], U]:
    """FastAPI dependency factory: ``uc: CreateProject = Depends(provide(CreateProject))``."""

    def dependency(request: Request) -> U:
        return request.app.state.container.build(use_case)

    return dependency
