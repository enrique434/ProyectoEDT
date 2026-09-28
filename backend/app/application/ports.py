"""Ports (interfaces) the application layer depends on. Infrastructure implements them (DIP)."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date, datetime
from typing import Callable, List, Optional

from app.domain.entities.project import Project
from app.domain.value_objects.enums import Methodology


@dataclass(frozen=True)
class ProjectListing:
    """Lightweight read model for the project list (RF-06)."""

    id: str
    name: str
    description: str
    methodology: Methodology
    start_date: date
    target_date: Optional[date]
    finish: Optional[datetime]
    item_count: int
    updated_at: datetime


class ProjectRepository(ABC):
    @abstractmethod
    def get(self, project_id: str) -> Project:
        """Loads the full aggregate or raises ``NotFoundError``."""

    @abstractmethod
    def list(self) -> List[ProjectListing]: ...

    @abstractmethod
    def add(self, project: Project) -> None: ...

    @abstractmethod
    def save(self, project: Project) -> None: ...

    @abstractmethod
    def delete(self, project_id: str) -> None: ...


class UnitOfWork(ABC):
    """Transaction boundary (RNF-13). Rolls back automatically unless ``commit`` is called."""

    projects: ProjectRepository

    def __enter__(self) -> "UnitOfWork":
        return self

    def __exit__(self, *exc_info) -> None:
        self.rollback()

    @abstractmethod
    def commit(self) -> None: ...

    @abstractmethod
    def rollback(self) -> None: ...


UnitOfWorkFactory = Callable[[], UnitOfWork]
Clock = Callable[[], datetime]
