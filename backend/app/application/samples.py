"""Demonstration projects (RF-47): the 'software project' from the requirements, per methodology."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Dict, Iterable, Optional, Tuple

from app.domain.entities.calendar import CalendarException
from app.domain.entities.project import ItemFields, Project
from app.domain.entities.resources import Member
from app.domain.entities.work_item import WorkItem
from app.domain.value_objects.duration import TimeUnit
from app.domain.value_objects.enums import DependencyType as T, Methodology, Priority, WorkItemKind as K
from app.domain.value_objects.pert import PertEstimate

TeamSpec = Iterable[Tuple[str, str, str]]  # (name, role name, responsibility)


class _Builder:
    """Small fluent helper to keep the sample definitions readable."""

    def __init__(self, project: Project) -> None:
        self.p = project

    def item(self, kind: K, name: str, parent: Optional[WorkItem] = None, days: Optional[float] = None,
             objective: str = "") -> WorkItem:
        fields = ItemFields(objective=objective, duration_value=days, duration_unit=TimeUnit.DAY)
        return self.p.add_item(kind, name, parent.id if parent else None, fields)

    def pert(self, item: WorkItem, o: float, m: float, p: float) -> WorkItem:
        item.apply_pert(PertEstimate(o, m, p), TimeUnit.DAY, self.p.converter)
        return item

    def link(self, pred: WorkItem, succ: WorkItem, kind: T = T.FS, lag_days: float = 0) -> None:
        self.p.add_dependency(pred.id, succ.id, kind, lag_days, TimeUnit.DAY)

    def team(self, spec: TeamSpec) -> Dict[str, Member]:
        roles = {r.name: r.id for r in self.p.roles.values()}
        return {name: self.p.add_member(Member("", name, roles.get(role), responsibility=resp))
                for name, role, resp in spec}

    def assign(self, item: WorkItem, *members: Member) -> None:
        self.p.set_assignments(item.id, [(m.id, 100) for m in members])


class SampleProjectFactory:
    def build(self, methodology: Methodology, start: date) -> Project:
        builders = {Methodology.TRADITIONAL: self._traditional,
                    Methodology.AGILE: self._agile,
                    Methodology.HYBRID: self._hybrid}
        project = builders[methodology](start)
        self._add_holiday(project, start)
        return project

    @staticmethod
    def _add_holiday(project: Project, start: date) -> None:
        holiday = start + timedelta(days=21)
        while holiday.weekday() >= 5:
            holiday += timedelta(days=1)
        project.calendar.set_exceptions([CalendarException(holiday, "Feriado (ejemplo)")])

    # ------------------------------------------------------------ traditional
    def _traditional(self, start: date) -> Project:
        b = _Builder(Project.create("Sistema de Ventas (Tradicional)", Methodology.TRADITIONAL, start,
                                    "Proyecto de ejemplo en cascada: fases secuenciales con tareas y subtareas.",
                                    start + timedelta(days=100)))
        t = b.team([("Laura Pérez", "Project Manager", "Planificación y seguimiento"),
                    ("Carlos Ruiz", "Analista", "Levantamiento de requisitos"),
                    ("Ana Torres", "Arquitecto", "Diseño técnico"),
                    ("Jonathan Díaz", "Desarrollador", "Backend"),
                    ("María León", "Tester", "Calidad")])
        analysis, design, dev = b.item(K.PHASE, "Análisis"), b.item(K.PHASE, "Diseño"), b.item(K.PHASE, "Desarrollo")
        tests, deploy = b.item(K.PHASE, "Pruebas"), b.item(K.PHASE, "Implementación")

        req = b.pert(b.item(K.TASK, "Levantamiento de requisitos", analysis), 3, 5, 9)
        val = b.item(K.TASK, "Validación con el cliente", analysis, 2)
        arch = b.item(K.TASK, "Arquitectura", design, 4)
        proto = b.item(K.TASK, "Prototipo de interfaces", design, 5)
        users = b.item(K.TASK, "Módulo de usuarios", dev)
        login, register = b.item(K.SUBTASK, "Login", users, 3), b.item(K.SUBTASK, "Registro", users, 2)
        sales = b.pert(b.item(K.TASK, "Módulo de ventas", dev), 6, 8, 14)
        reports = b.item(K.TASK, "Reportes", dev, 4)
        integration = b.item(K.TASK, "Pruebas integrales", tests, 5)
        fixes = b.item(K.TASK, "Corrección de defectos", tests, 4)
        release = b.item(K.TASK, "Despliegue en producción", deploy, 2)
        training = b.item(K.TASK, "Capacitación de usuarios", deploy, 3)
        done = b.item(K.MILESTONE, "Entrega final")

        b.link(req, val)
        b.link(analysis, design)
        b.link(arch, proto, T.SS, 2)
        b.link(design, dev)
        b.link(login, register)
        b.link(users, sales)
        b.link(users, reports)
        b.link(dev, tests)
        b.link(integration, fixes, T.SS, 2)
        b.link(tests, deploy)
        b.link(release, training, T.SS, 1)
        b.link(deploy, done)

        b.assign(req, t["Carlos Ruiz"]); b.assign(val, t["Carlos Ruiz"], t["Laura Pérez"])
        b.assign(arch, t["Ana Torres"]); b.assign(proto, t["Ana Torres"])
        b.assign(login, t["Jonathan Díaz"]); b.assign(register, t["Jonathan Díaz"])
        b.assign(sales, t["Jonathan Díaz"]); b.assign(reports, t["Ana Torres"])
        b.assign(integration, t["María León"]); b.assign(fixes, t["Jonathan Díaz"])
        b.assign(release, t["Ana Torres"]); b.assign(training, t["Laura Pérez"])
        req.set_progress(100); val.set_progress(40)
        sales.priority = Priority.HIGH
        return b.p

    # ------------------------------------------------------------------ agile
    def _agile(self, start: date) -> Project:
        b = _Builder(Project.create("App Móvil de Pedidos (Ágil)", Methodology.AGILE, start,
                                    "Proyecto de ejemplo Scrum: sprints secuenciales y un sprint paralelo.",
                                    start + timedelta(days=70)))
        t = b.team([("Sofía Vega", "Product Owner", "Backlog y prioridades"),
                    ("Diego Mora", "Scrum Master", "Facilitación"),
                    ("Jonathan Díaz", "Development Team", "Desarrollo"),
                    ("Ana Torres", "Development Team", "Desarrollo"),
                    ("Lucía Ramos", "UX/UI", "Experiencia de usuario"),
                    ("María León", "Tester/QA", "Calidad")])
        s1 = b.item(K.SPRINT, "Sprint 1", objective="Autenticación y gestión de usuarios")
        s2 = b.item(K.SPRINT, "Sprint 2", objective="Catálogo de productos y clientes")
        s3 = b.item(K.SPRINT, "Sprint 3", objective="Pedidos y pagos")
        ux = b.item(K.SPRINT, "Sprint UX", objective="Rediseño visual (en paralelo)")

        us1 = b.item(K.STORY, "US-01 Iniciar sesión", s1)
        ui, api = b.item(K.SUBTASK, "Pantalla de login", us1, 2), b.item(K.SUBTASK, "API de autenticación", us1, 3)
        us2 = b.pert(b.item(K.STORY, "US-02 Gestionar usuarios", s1), 3, 4, 7)
        us3 = b.item(K.STORY, "US-03 Catálogo de productos", s2, 5)
        us4 = b.item(K.STORY, "US-04 Registro de clientes", s2, 4)
        us5 = b.pert(b.item(K.STORY, "US-05 Crear pedido", s3), 4, 6, 10)
        us6 = b.item(K.STORY, "US-06 Pago en línea", s3, 3)
        style = b.item(K.TASK, "Guía de estilos", ux, 3)
        mock = b.item(K.TASK, "Mockups de alta fidelidad", ux, 4)
        mvp = b.item(K.MILESTONE, "Release MVP")

        b.link(ui, api, T.SS, 1)
        b.link(s1, s2)
        b.link(s2, s3)
        b.link(s1, ux)  # Sprint UX runs in parallel with Sprint 2 (RN-25)
        b.link(style, mock)
        b.link(us5, us6)
        b.link(s3, mvp)
        b.link(ux, mvp)

        b.assign(ui, t["Ana Torres"]); b.assign(api, t["Jonathan Díaz"]); b.assign(us2, t["Ana Torres"])
        b.assign(us3, t["Jonathan Díaz"]); b.assign(us4, t["Ana Torres"]); b.assign(us5, t["Jonathan Díaz"])
        b.assign(us6, t["Ana Torres"]); b.assign(style, t["Lucía Ramos"]); b.assign(mock, t["Lucía Ramos"])
        ui.set_progress(100); api.set_progress(60)
        return b.p

    # ----------------------------------------------------------------- hybrid
    def _hybrid(self, start: date) -> Project:
        b = _Builder(Project.create("Proyecto de Software (Híbrido)", Methodology.HYBRID, start,
                                    "Fases tradicionales con desarrollo y pruebas iterativos (sección 14).",
                                    start + timedelta(days=110)))
        t = b.team([("Laura Pérez", "Project Manager", "Gestión global"),
                    ("Sofía Vega", "Product Owner", "Backlog"),
                    ("Diego Mora", "Scrum Master", "Facilitación"),
                    ("Carlos Ruiz", "Analista", "Requisitos"),
                    ("Jonathan Díaz", "Desarrollador", "Backend"),
                    ("Ana Torres", "Desarrollador", "Frontend"),
                    ("María León", "Tester", "QA")])
        analysis, design = b.item(K.PHASE, "Análisis"), b.item(K.PHASE, "Diseño")
        dev, tests, deploy = b.item(K.PHASE, "Desarrollo"), b.item(K.PHASE, "Pruebas"), b.item(K.PHASE, "Implementación")

        req = b.pert(b.item(K.TASK, "Requisitos", analysis), 3, 4, 8)
        val = b.item(K.TASK, "Validación", analysis, 2)
        arch = b.item(K.TASK, "Arquitectura", design, 4)
        proto = b.item(K.TASK, "Prototipo", design, 3)
        s1 = b.item(K.SPRINT, "Sprint 1", dev, objective="Login y usuarios")
        s2 = b.item(K.SPRINT, "Sprint 2", dev, objective="Productos y clientes")
        s3 = b.item(K.SPRINT, "Sprint 3", dev, objective="Ventas")
        login, users = b.item(K.TASK, "Login", s1, 3), b.item(K.TASK, "Usuarios", s1, 5)
        products, clients = b.item(K.TASK, "Productos", s2, 4), b.item(K.TASK, "Clientes", s2, 4)
        sales = b.pert(b.item(K.TASK, "Ventas", s3), 5, 7, 12)
        qa = b.item(K.SPRINT, "Sprint QA", tests, objective="Regresión y aceptación")
        regression, acceptance = b.item(K.TASK, "Pruebas de regresión", qa, 4), b.item(K.TASK, "Pruebas de aceptación", qa, 3)
        release = b.item(K.TASK, "Despliegue", deploy, 2)
        golive = b.item(K.MILESTONE, "Puesta en producción", deploy)

        b.link(req, val)
        b.link(analysis, design)
        b.link(arch, proto, T.SS, 1)
        b.link(design, dev)
        b.link(s1, s2)
        b.link(s2, s3)
        b.link(s2, qa)  # QA overlaps with Sprint 3
        b.link(regression, acceptance)
        b.link(dev, deploy)
        b.link(tests, deploy)
        b.link(release, golive)

        b.assign(req, t["Carlos Ruiz"]); b.assign(val, t["Carlos Ruiz"], t["Sofía Vega"])
        b.assign(arch, t["Jonathan Díaz"]); b.assign(proto, t["Ana Torres"])
        b.assign(login, t["Jonathan Díaz"]); b.assign(users, t["Ana Torres"])
        b.assign(products, t["Jonathan Díaz"]); b.assign(clients, t["Ana Torres"])
        b.assign(sales, t["Jonathan Díaz"], t["Ana Torres"])
        b.assign(regression, t["María León"]); b.assign(acceptance, t["María León"], t["Sofía Vega"])
        b.assign(release, t["Jonathan Díaz"])
        req.set_progress(100); val.set_progress(50)
        return b.p
