"""WBS (EDT) items, assignments and dependencies endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status

from app.api import presenters, schemas as s
from app.api.container import provide
from app.application.use_cases.dependencies import (
    CreateDependency,
    CreateDependencyCommand,
    DeleteDependency,
    UpdateDependency,
    UpdateDependencyCommand,
)
from app.application.use_cases.projects import GetProject
from app.application.use_cases.team import SetAssignments
from app.application.use_cases.wbs import (
    CreateItem,
    CreateItemCommand,
    DeleteItem,
    MoveItem,
    MoveItemCommand,
    PertData,
    UpdateItem,
    UpdateItemCommand,
)
from app.domain.value_objects.enums import DeletionStrategy

router = APIRouter(prefix="/api/projects/{project_id}", tags=["EDT"])


@router.post("/items", response_model=s.CreatedOut, status_code=status.HTTP_201_CREATED)
def create_item(project_id: str, body: s.ItemCreateIn, uc: CreateItem = Depends(provide(CreateItem)),
                get: GetProject = Depends(provide(GetProject))):
    item = uc.execute(CreateItemCommand(project_id, body.kind, body.name, body.parent_id, body.description,
                                        body.objective, body.duration_value, body.duration_unit))
    return s.CreatedOut(id=item.id, project=presenters.project_out(get.execute(project_id)))


@router.put("/items/{item_id}", response_model=s.ProjectOut)
def update_item(project_id: str, item_id: str, body: s.ItemUpdateIn, uc: UpdateItem = Depends(provide(UpdateItem)),
                get: GetProject = Depends(provide(GetProject))):
    data = body.model_dump(exclude={"pert"})
    pert = PertData(**body.pert.model_dump()) if body.pert else None
    uc.execute(UpdateItemCommand(project_id=project_id, item_id=item_id, pert=pert, **data))
    return presenters.project_out(get.execute(project_id))


@router.post("/items/{item_id}/move", response_model=s.ProjectOut)
def move_item(project_id: str, item_id: str, body: s.MoveIn, uc: MoveItem = Depends(provide(MoveItem)),
              get: GetProject = Depends(provide(GetProject))):
    uc.execute(MoveItemCommand(project_id, item_id, body.parent_id, body.position))
    return presenters.project_out(get.execute(project_id))


@router.delete("/items/{item_id}", response_model=s.ProjectOut)
def delete_item(project_id: str, item_id: str,
                strategy: DeletionStrategy = Query(DeletionStrategy.REJECT,
                                                   description="Cómo resolver dependencias (RN-28)"),
                uc: DeleteItem = Depends(provide(DeleteItem)), get: GetProject = Depends(provide(GetProject))):
    uc.execute(project_id, item_id, strategy)
    return presenters.project_out(get.execute(project_id))


@router.put("/items/{item_id}/assignments", response_model=s.ProjectOut, tags=["Recursos"])
def set_assignments(project_id: str, item_id: str, body: s.AssignmentsIn,
                    uc: SetAssignments = Depends(provide(SetAssignments))):
    project = uc.execute(project_id, item_id, [(a.member_id, a.units) for a in body.assignments])
    return presenters.project_out(project)


@router.post("/dependencies", response_model=s.CreatedOut, status_code=status.HTTP_201_CREATED,
             tags=["Dependencias"])
def create_dependency(project_id: str, body: s.DependencyCreateIn,
                      uc: CreateDependency = Depends(provide(CreateDependency)),
                      get: GetProject = Depends(provide(GetProject))):
    dependency = uc.execute(CreateDependencyCommand(project_id, body.predecessor_id, body.successor_id, body.type,
                                                    body.lag_value, body.lag_unit))
    return s.CreatedOut(id=dependency.id, project=presenters.project_out(get.execute(project_id)))


@router.put("/dependencies/{dependency_id}", response_model=s.ProjectOut, tags=["Dependencias"])
def update_dependency(project_id: str, dependency_id: str, body: s.DependencyUpdateIn,
                      uc: UpdateDependency = Depends(provide(UpdateDependency)),
                      get: GetProject = Depends(provide(GetProject))):
    uc.execute(UpdateDependencyCommand(project_id, dependency_id, body.type, body.lag_value, body.lag_unit))
    return presenters.project_out(get.execute(project_id))


@router.delete("/dependencies/{dependency_id}", response_model=s.ProjectOut, tags=["Dependencias"])
def delete_dependency(project_id: str, dependency_id: str, uc: DeleteDependency = Depends(provide(DeleteDependency)),
                      get: GetProject = Depends(provide(GetProject))):
    uc.execute(project_id, dependency_id)
    return presenters.project_out(get.execute(project_id))
