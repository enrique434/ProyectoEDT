# ProyectoEDT

Aplicación **web** de planificación de proyectos inspirada en ProjectLibre. A partir de la
**EDT** genera el cronograma con calendario laboral, **PERT**, dependencias **PDM**
(FS/SS/FF/SF + lag/lead), **CPM**, **Ruta Crítica** y **Diagrama de Gantt**. Soporta
proyectos **tradicionales, ágiles e híbridos** sobre un único modelo.

El análisis completo (requerimientos, reglas, arquitectura y decisiones) está en
[docs/ANALISIS.md](docs/ANALISIS.md).

## Stack

| Capa | Tecnología |
|---|---|
| Backend | Python 3.10+, FastAPI, Pydantic v2 |
| Persistencia | SQLAlchemy 2.0 + Alembic, SQLite por defecto (cualquier motor vía `DATABASE_URL`) |
| Frontend | React + TypeScript + Vite, TanStack Query, Gantt en SVG propio |
| Pruebas | pytest (dominio, API de punta a punta y regla de arquitectura) |

## Puesta en marcha (desarrollo)

**Backend** (terminal 1):

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate      Linux/macOS: source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.asgi:app --reload --port 8000
```

La base de datos `backend/data/proyecto_edt.db` y sus tablas se crean solas al arrancar
(migraciones Alembic). La documentación de la API queda en http://localhost:8000/docs.

**Frontend** (terminal 2):

```bash
cd frontend
npm install
npm run dev
```

Abra http://localhost:5173. Vite redirige `/api` al backend.

## Despliegue con un solo servidor

```bash
cd frontend && npm run build        # genera frontend/dist
cd ../backend && uvicorn app.asgi:app --host 0.0.0.0 --port 8000
```

FastAPI sirve la aplicación compilada y la API en el mismo puerto: http://localhost:8000.

### Usar otra base de datos

Cree `backend/.env` con, por ejemplo:

```
DATABASE_URL=postgresql+psycopg://usuario:clave@localhost:5432/proyecto_edt
```

e instale el driver (`pip install psycopg[binary]`). No hay que cambiar nada del código:
la persistencia está detrás de un repositorio.

## Pruebas

```bash
cd backend
pytest
```

Cubren los motores (calendario, PERT, CPM con FS/SS/FF/SF y lag, ciclos), las reglas del
agregado `Project`, el flujo completo por la API (crear → calendario → equipo → EDT →
PERT → dependencias → CPM → cerrar y reabrir), y verifican que `domain/` no dependa de
frameworks.

## Estructura

```
backend/app/
├── domain/            Python puro: entidades, value objects y los 5 motores
│   ├── entities/      Project (agregado), WorkItem, Dependency, Calendar, Role/Member
│   ├── services/      working_time, graph, network, cpm, scheduler, methodology, resource_load
│   └── value_objects/ enums, duration (unidad interna = minutos laborables), pert
├── application/       casos de uso (Template Method), puertos, proyectos de ejemplo
├── infrastructure/    SQLAlchemy: modelos, mappers, repositorio, Unit of Work
└── api/               routers FastAPI, esquemas, presentadores, contenedor de DI
frontend/src/
├── api/               tipos, cliente HTTP, hooks de React Query
├── features/          plan (EDT + Gantt), gantt, calendar, team, cpm, resources, projects
├── pages/             lista de proyectos, proyecto (pestañas)
└── lib/               etiquetas, formato, utilidades de la EDT
```

## Uso rápido

1. En **Proyectos**, pulse **Crear ejemplo → Proyecto híbrido** para ver el ciclo completo, o
   **+ Nuevo proyecto** para empezar desde cero.
2. **EDT y Gantt**: agregue fases, sprints, tareas, subtareas e hitos con la barra de
   herramientas. La metodología habilita sólo lo permitido. Doble clic abre el editor
   (duración manual o PERT, restricciones, dependencias y responsables). Arrastre una barra
   sobre otra para crear una dependencia FS.
3. **Ruta crítica / CPM**: tabla ES/EF/LS/LF, holguras, secuencia crítica y probabilidad
   PERT de cumplir la fecha objetivo.
4. **Calendario**, **Equipo**, **Recursos** y **Configuración** completan la planificación.
   Todo se guarda al instante y se recalcula automáticamente.
