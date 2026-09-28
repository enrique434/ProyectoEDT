"""Projects, calendar, schedule and resource load endpoints."""
from __future__ import annotations

from datetime import date
from typing import List

from fastapi import APIRouter, Depends, status

from app.api import presenters, schemas as s
from app.api.container import provide
from app.application.use_cases.calendar import ExceptionData, UpdateCalendar, UpdateCalendarCommand
from app.application.use_cases.projects import (
    CreateProject,
    CreateProjectCommand,
    CreateSampleProject,
    DeleteProject,
    GetProject,
    ListProjects,
    RecalculateSchedule,
    UpdateProject,
    UpdateProjectCommand,
)
from app.application.use_cases.team import GetResourceLoad

router = APIRouter(prefix="/api", tags=["Proyectos"])


@router.get("/methodologies", response_model=List[s.MethodologyOut])
def list_methodologies() -> List[s.MethodologyOut]:
    return presenters.methodologies_out()


@router.get("/projects", response_model=List[s.ProjectListItemOut])
def list_projects(uc: ListProjects = Depends(provide(ListProjects))):
    return [presenters.listing_out(listing) for listing in uc.execute()]


@router.post("/projects", response_model=s.ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(body: s.ProjectCreateIn, uc: CreateProject = Depends(provide(CreateProject))):
    project = uc.execute(CreateProjectCommand(
        name=body.name, methodology=body.methodology, start_date=body.start_date, description=body.description,
        target_date=body.target_date, settings=presenters.settings_from(body.settings) if body.settings else None))
    return presenters.project_out(project)


@router.post("/projects/samples", response_model=s.ProjectOut, status_code=status.HTTP_201_CREATED)
def create_sample(body: s.SampleIn, uc: CreateSampleProject = Depends(provide(CreateSampleProject))):
    return presenters.project_out(uc.execute(body.methodology, body.start_date or date.today()))


@router.get("/projects/{project_id}", response_model=s.ProjectOut)
def get_project(project_id: str, uc: GetProject = Depends(provide(GetProject))):
    return presenters.project_out(uc.execute(project_id))


@router.put("/projects/{project_id}", response_model=s.ProjectOut)
def update_project(project_id: str, body: s.ProjectUpdateIn, uc: UpdateProject = Depends(provide(UpdateProject))):
    project = uc.execute(UpdateProjectCommand(
        project_id=project_id, name=body.name, description=body.description, methodology=body.methodology,
        start_date=body.start_date, target_date=body.target_date, settings=presenters.settings_from(body.settings)))
    return presenters.project_out(project)


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: str, uc: DeleteProject = Depends(provide(DeleteProject))) -> None:
    uc.execute(project_id)


@router.put("/projects/{project_id}/calendar", response_model=s.ProjectOut, tags=["Calendario"])
def update_calendar(project_id: str, body: s.CalendarIn, uc: UpdateCalendar = Depends(provide(UpdateCalendar))):
    command = UpdateCalendarCommand(
        project_id=project_id, week=presenters.week_from(body),
        exceptions=[ExceptionData(e.day, e.name, [(iv.start, iv.end) for iv in e.intervals]) for e in body.exceptions])
    return presenters.project_out(uc.execute(command))


@router.post("/projects/{project_id}/schedule", response_model=s.ProjectOut, tags=["Planificación"])
def recalculate(project_id: str, uc: RecalculateSchedule = Depends(provide(RecalculateSchedule))):
    return presenters.project_out(uc.execute(project_id))


@router.get("/projects/{project_id}/resource-load", response_model=List[s.MemberLoadOut], tags=["Recursos"])
def resource_load(project_id: str, uc: GetResourceLoad = Depends(provide(GetResourceLoad))):
    project, loads = uc.execute(project_id)
    return presenters.resource_load_out(project, loads)
