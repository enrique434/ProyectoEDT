"""Roles and members endpoints (CU-05, CU-06)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.api import presenters, schemas as s
from app.api.container import provide
from app.application.use_cases.projects import GetProject
from app.application.use_cases.team import (
    CreateMember,
    CreateRole,
    DeleteMember,
    DeleteRole,
    MemberData,
    RoleData,
    UpdateMember,
    UpdateRole,
)

router = APIRouter(prefix="/api/projects/{project_id}", tags=["Equipo"])


@router.post("/roles", response_model=s.CreatedOut, status_code=status.HTTP_201_CREATED)
def create_role(project_id: str, body: s.RoleIn, uc: CreateRole = Depends(provide(CreateRole)),
                get: GetProject = Depends(provide(GetProject))):
    role = uc.execute(project_id, RoleData(body.name, body.description))
    return s.CreatedOut(id=role.id, project=presenters.project_out(get.execute(project_id)))


@router.put("/roles/{role_id}", response_model=s.ProjectOut)
def update_role(project_id: str, role_id: str, body: s.RoleIn, uc: UpdateRole = Depends(provide(UpdateRole)),
                get: GetProject = Depends(provide(GetProject))):
    uc.execute(project_id, role_id, RoleData(body.name, body.description))
    return presenters.project_out(get.execute(project_id))


@router.delete("/roles/{role_id}", response_model=s.ProjectOut)
def delete_role(project_id: str, role_id: str, uc: DeleteRole = Depends(provide(DeleteRole)),
                get: GetProject = Depends(provide(GetProject))):
    uc.execute(project_id, role_id)
    return presenters.project_out(get.execute(project_id))


@router.post("/members", response_model=s.CreatedOut, status_code=status.HTTP_201_CREATED)
def create_member(project_id: str, body: s.MemberIn, uc: CreateMember = Depends(provide(CreateMember)),
                  get: GetProject = Depends(provide(GetProject))):
    member = uc.execute(project_id, MemberData(**body.model_dump()))
    return s.CreatedOut(id=member.id, project=presenters.project_out(get.execute(project_id)))


@router.put("/members/{member_id}", response_model=s.ProjectOut)
def update_member(project_id: str, member_id: str, body: s.MemberIn, uc: UpdateMember = Depends(provide(UpdateMember)),
                  get: GetProject = Depends(provide(GetProject))):
    uc.execute(project_id, member_id, MemberData(**body.model_dump()))
    return presenters.project_out(get.execute(project_id))


@router.delete("/members/{member_id}", response_model=s.ProjectOut)
def delete_member(project_id: str, member_id: str, uc: DeleteMember = Depends(provide(DeleteMember)),
                  get: GetProject = Depends(provide(GetProject))):
    uc.execute(project_id, member_id)
    return presenters.project_out(get.execute(project_id))
