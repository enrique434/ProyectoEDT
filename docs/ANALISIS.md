# ProyectoEDT — Análisis y especificación del MVP

Aplicación **web** de planificación y seguimiento de proyectos inspirada en ProjectLibre.
A partir de una **EDT** (Estructura de Desglose del Trabajo) genera automáticamente el
cronograma: fechas según calendario laboral, estimaciones PERT, dependencias PDM, CPM,
Ruta Crítica y Diagrama de Gantt. Soporta proyectos **tradicionales, ágiles e híbridos**
sobre un único modelo.

> Nota: el documento original habla de "aplicación de escritorio". Por decisión del
> equipo el sistema es **web**: "cerrar y volver a abrir la aplicación" se interpreta como
> cerrar el navegador / reiniciar el servidor y recuperar todo desde la base de datos.

---

## 1. Decisiones de arquitectura

| Decisión | Elección | Motivo |
|---|---|---|
| Backend | Python 3.10+ · FastAPI · Pydantic v2 | API tipada, documentación OpenAPI automática |
| Frontend | React 18 + TypeScript + Vite · TanStack Query | SPA interactiva; Gantt SVG propio |
| Persistencia | SQLAlchemy 2.0 + Alembic · **SQLite** por defecto | Cero instalación. Portable a otro motor cambiando `DATABASE_URL` |
| Estilo | Clean Architecture + SOLID + DDD táctico | Dominio independiente de BD y web (RNF-01) |
| Pruebas | pytest (dominio, casos de uso y API) | Motores probados aisladamente (RNF-10) |

### 1.1 Capas (regla de dependencia: siempre hacia adentro)

```
┌──────────────────────────────────────────────────────────────┐
│ api/ (FastAPI)          frontend/ (React)                    │  Presentación
├──────────────────────────────────────────────────────────────┤
│ infrastructure/  SQLAlchemy, mappers, repositorio, UoW       │  Adaptadores
├──────────────────────────────────────────────────────────────┤
│ application/     casos de uso, comandos, puertos             │  Aplicación
├──────────────────────────────────────────────────────────────┤
│ domain/          entidades, value objects, motores           │  Dominio (Python puro)
└──────────────────────────────────────────────────────────────┘
```

### 1.2 Patrones aplicados

| Patrón | Dónde | Para qué |
|---|---|---|
| Aggregate Root (DDD) | `Project` | Toda modificación pasa por el proyecto → invariantes garantizadas (RN-01…RN-28) |
| Value Object | `PertEstimate`, `WorkInterval`, `DurationConverter` | Inmutables y autovalidados |
| Strategy | `MethodologyRules` (Tradicional/Ágil/Híbrido) | Nueva metodología = nueva clase, sin tocar algoritmos (RNF-11, OCP) |
| Registry | `rules_for(methodology)` | Resolver la estrategia sin `if/elif` |
| Repository + Unit of Work | `ProjectRepository`, `UnitOfWork` | Persistencia transaccional intercambiable (DIP, RNF-13) |
| Template Method | `ProjectMutationUseCase` | Cargar → modificar → recalcular → guardar, en un único lugar (RN-23) |
| Builder | `SchedulingNetworkBuilder` | Traducir la EDT a la red de actividades del CPM |
| Data Mapper | `infrastructure/persistence/mappers.py` | El dominio no conoce el ORM |
| Dependency Injection | `api/container.py` | Composición en el borde del sistema |

---

## 2. Los cinco motores

```
            Project (EDT + calendario + recursos)
                             │
     ┌───────────────────────┼─────────────────────────┐
     ▼                       ▼                         ▼
WorkingTimeCalculator   SchedulingNetworkBuilder   PertEstimate
(calendario)            (dependencias → red)       (duraciones)
     │                       │
     │                       ▼
     │                   CpmEngine  ── pase adelante / atrás, holguras
     │                       │
     └──────────► ProjectScheduler ──► fechas + Ruta Crítica + prob. PERT
                             │
                             ▼
                     Gantt (frontend, SVG)
```

1. **Calendario** (`WorkingTimeCalculator`): convierte *minutos laborables* ↔ fecha/hora
   respetando jornada por día de semana, feriados y excepciones.
2. **Dependencias** (`SchedulingNetworkBuilder` + `topological_order`): arma la red y
   detecta ciclos (algoritmo de Kahn + DFS para reportar el ciclo exacto).
3. **PERT** (`PertEstimate`): TE = (O + 4M + P) / 6, σ = (P − O) / 6.
4. **CPM** (`CpmEngine`): ES, EF, LS, LF, holgura total y libre, criticidad. Es genérico:
   no conoce fechas ni la EDT.
5. **Gantt**: el backend entrega fechas calculadas; el frontend las dibuja.

### 2.1 Unidad temporal interna (RNF-12)

Todo cálculo se hace en **minutos laborables enteros** desde el inicio del proyecto.
Las unidades de usuario se convierten con parámetros del proyecto:

| Unidad | Conversión (configurable) |
|---|---|
| hora | 60 min |
| día | `minutes_per_day` (por defecto 480) |
| semana | `days_per_week` × día (por defecto 5) |
| mes | `days_per_month` × día (por defecto 20) |

Sólo el motor de calendario traduce minutos a fechas reales; así feriados y fines de
semana **no consumen duración** (RN-16).

### 2.2 EDT → red CPM (decisión clave)

* Las actividades **hoja** (tareas, subtareas, historias, hitos sin hijos) son nodos con duración.
* Las actividades **resumen** (fases, sprints, tareas con subtareas) se representan con dos
  nodos virtuales de duración 0: `inicio` y `fin`.
  `inicio → cada hijo → fin`. Sus fechas se derivan de los hijos (sección 12 del requerimiento).
* Un **sprint** además tiene *timebox*: `fin ≥ inicio + duración del sprint`.
* Una dependencia sobre un resumen se conecta a su nodo `inicio` o `fin` según el tipo.
  Así funcionan Sprint→Sprint, Fase→Fase, Fase→Tarea, etc. **sin casos especiales**, y
  los sprints sin dependencias entre sí quedan **en paralelo** (RN-25).
* Una dependencia entre un elemento y su propio ancestro produce un ciclo y se rechaza.

### 2.3 Ecuaciones PDM generalizadas (d = duración, L = lag; lead = lag negativo)

| Tipo | Pase hacia adelante (sucesor s) | Pase hacia atrás (predecesor p) |
|---|---|---|
| FS | ES_s ≥ EF_p + L | LF_p ≤ LS_s − L |
| SS | ES_s ≥ ES_p + L | LF_p ≤ LS_s − L + d_p |
| FF | ES_s ≥ EF_p + L − d_s | LF_p ≤ LF_s − L |
| SF | ES_s ≥ ES_p + L − d_s | LF_p ≤ LF_s − L + d_p |

ES ≥ 0 (inicio del proyecto) y ES ≥ restricción (SNET/FNET).
Holgura total = LS − ES. **Crítica ⇔ holgura total = 0** (RN-22).

### 2.4 Probabilidad PERT de cumplir la fecha objetivo

Se busca la cadena crítica de mayor varianza, σ² = Σσᵢ², y
P(T ≤ objetivo) = Φ((objetivo − duración) / σ).

---

## 3. Modelo de dominio

```
Project (aggregate root)
├── ProjectSettings   unidad por defecto, duración de tarea/sprint, conversiones
├── WorkCalendar      semana laboral (intervalos por día) + excepciones/feriados
├── Role[]            configurables; sembrados según metodología
├── Member[]          nombre, rol, responsabilidad, horas/día, activo
├── WorkItem[]        EDT: PHASE | SPRINT | STORY | TASK | SUBTASK | MILESTONE
│     parent_id       ← JERARQUÍA  (¿a quién pertenece?)
├── Dependency[]      ← DEPENDENCIA (¿qué debe ocurrir antes?) FS/SS/FF/SF + lag
└── Assignment[]      ← ASIGNACIÓN (¿quién trabaja?) miembro + % de dedicación
```

Las tres relaciones (jerarquía, dependencia, asignación) se modelan por separado
(sección 15 del requerimiento). No hay campos `previous_sprint_id`/`next_sprint_id`.

### 3.1 Reglas de estructura por metodología (Strategy)

| Contenedor | Tradicional | Ágil | Híbrido |
|---|---|---|---|
| Proyecto (raíz) | Fase, Hito | Sprint, Historia, Tarea (backlog), Hito | Fase, Hito |
| Fase | Tarea, Hito | — | Tarea, Sprint, Hito |
| Sprint | — | Historia, Tarea, Hito | Historia, Tarea, Hito |
| Historia / Tarea | Subtarea | Subtarea | Subtarea |
| Subtarea / Hito | — | — | — |

---

## 4. Requerimientos funcionales (definidos para el MVP)

Los requerimientos del documento original (RF-01…RF-40) se conservan. Se agregan los
marcados con ➕, que un clon funcional de ProjectLibre necesita.

| Código | Requerimiento | Prioridad | Estado |
|---|---|---|---|
| RF-01…06 | Crear, elegir metodología, abrir, guardar (automático), editar, listar y eliminar proyectos | Alta | ✅ |
| RF-07/08 | Calendario: jornada por día (1..n intervalos), feriados y excepciones laborables | Alta | ✅ |
| RF-09/10/11 | Integrantes, roles configurables, disponibilidad (horas/día, activo) | Alta/Media | ✅ |
| RF-12…15 | CRUD de fases, sprints, historias, tareas y subtareas según metodología | Alta | ✅ |
| RF-16 | Asignar responsables con % de dedicación | Alta | ✅ |
| RF-17…22 | Dependencias FS/SS/FF/SF con lag/lead en h/d/sem/mes | Alta | ✅ |
| RF-23 | Rechazar ciclos y autodependencias mostrando el ciclo | Alta | ✅ |
| RF-24 | Hitos (duración 0, rombo en el Gantt) | Media | ✅ |
| RF-25 | PERT por actividad (TE, σ); TE como duración | Alta | ✅ |
| RF-26…32 | Fechas, recálculo, ES/EF/LS/LF, holgura total y libre, ruta crítica, fin del proyecto | Alta | ✅ |
| RF-33/34 | Gantt interactivo con ruta crítica resaltada | Alta | ✅ |
| RF-35…37 | Avance %, estados, prioridades | Media | ✅ |
| RF-38 | Sprints paralelos | Media | ✅ (automático) |
| RF-39/40 | Recalcular ante cambios; proyectos independientes | Alta | ✅ |
| ➕RF-41 | Códigos EDT automáticos (1, 1.2, 1.2.3) | Alta | ✅ |
| ➕RF-42 | Reordenar y mover elementos de la EDT validando reglas | Media | ✅ |
| ➕RF-43 | Restricciones de fecha: ASAP, "no comenzar antes de" (SNET), "no terminar antes de" (FNET) | Media | ✅ |
| ➕RF-44 | Tabla CPM completa (ES, EF, LS, LF, HT, HL) | Alta | ✅ |
| ➕RF-45 | Probabilidad PERT de cumplir la fecha objetivo | Media | ✅ |
| ➕RF-46 | Detectar sobreasignación de recursos por día | Media | ✅ |
| ➕RF-47 | Proyecto de ejemplo por metodología (demostración del ciclo completo) | Media | ✅ |
| ➕RF-48 | Alertas: fin calculado posterior a la fecha objetivo, sprint desbordado | Media | ✅ |
| ➕RF-49 | Eliminar actividad con dependencias: rechazar, eliminarlas o puentear (RN-28) | Alta | ✅ |
| ➕RF-50 | Columna "Predecesoras" estilo ProjectLibre (`3FS+2d`) | Baja | ✅ |

### Fuera del MVP (versiones futuras)

Línea base y comparación, nivelación automática de recursos, costos, calendario por
recurso, fechas reales de inicio/fin, autenticación y multiusuario, importar/exportar
MPP/XML de ProjectLibre, restricciones rígidas (MSO/MFO), exportación PDF del Gantt.

## 5. Requerimientos no funcionales

| Código | Requerimiento | Cómo se cumple |
|---|---|---|
| RNF-01 | Clean Architecture | `domain/` sin imports de FastAPI/SQLAlchemy (lo verifica un test) |
| RNF-02/03 | SOLID / Clean Code | Motores separados, estrategias, puertos, tipado estático |
| RNF-04 | Persistencia | SQLite con migraciones Alembic; guardado en cada operación |
| RNF-05 | Usabilidad | Vista EDT+Gantt estilo ProjectLibre, editor de actividad, pestañas y retroalimentación uniforme (sección 8) |
| RNF-06 | Integridad | Validación en dominio + FK en BD; nada inválido se persiste |
| RNF-07 | Rendimiento | CPM O(V+E); calendario con caché acumulativa y búsqueda binaria |
| RNF-08 | Portabilidad | Web: cualquier SO con navegador |
| RNF-09/10 | Mantenibilidad/Testabilidad | Motores puros con pruebas unitarias |
| RNF-11 | Extensibilidad | Nuevas metodologías vía `MethodologyRules` |
| RNF-12 | Unidad temporal interna | Minutos laborables enteros |
| RNF-13 | Recuperación | Unit of Work transaccional por caso de uso |
| RNF-14 | Trazabilidad | UUID para todas las entidades |

## 6. Reglas de negocio implementadas

RN-01…RN-28 del documento. Validación en el dominio:

* RN-11/12: autodependencia y ciclos → `CycleError` con el recorrido del ciclo.
* RN-17: `O ≤ M ≤ P` y todos ≥ 0 en `PertEstimate`.
* RN-19: los hitos siempre tienen duración 0.
* RN-20/21: avance entre 0 y 100; estado *Completada* ⇔ 100 %.
* RN-23/24: cada caso de uso que modifica el proyecto recalcula el cronograma en la misma transacción.
* RN-26: el fin nunca es anterior al inicio (duración ≥ 0).
* RN-27: `constraint` (fecha manual) se guarda aparte de las fechas calculadas.
* RN-28: eliminar con dependencias exige una estrategia (`reject`, `remove` o `bridge`).
* Adicional: no se permite una dependencia duplicada entre el mismo par de actividades.

## 7. Casos de uso ↔ API REST

| CU | Endpoint |
|---|---|
| CU-01/02/03 | `POST /api/projects`, `GET /api/projects/{id}` (el guardado es automático) |
| Listar/Editar/Eliminar | `GET /api/projects`, `PUT/DELETE /api/projects/{id}` |
| CU-04 | `PUT /api/projects/{id}/calendar` |
| CU-05/06 | `/api/projects/{id}/members`, `/api/projects/{id}/roles` |
| CU-07…10 | `/api/projects/{id}/items` (+ `/move`) |
| CU-11 | `PUT /api/projects/{id}/items/{item}/assignments` |
| CU-12 | `PUT /api/projects/{id}/items/{item}` con `estimation_mode = "pert"` |
| CU-13/14 | `/api/projects/{id}/dependencies` |
| CU-15…18 | `GET /api/projects/{id}` (cronograma incluido), `POST /api/projects/{id}/schedule` |
| CU-19 | `PUT /api/projects/{id}/items/{item}` (progreso/estado) |
| Recursos | `GET /api/projects/{id}/resource-load` |

Documentación interactiva: `http://localhost:8000/docs`.

---

## 8. Guía de retroalimentación al usuario

Toda acción del sistema (agregar, editar, eliminar, vincular, recalcular) comunica su
resultado con los mismos cuatro tonos y las mismas piezas visuales.

### 8.1 Tonos

| Tono | Cuándo | Ejemplo |
|---|---|---|
| Éxito (verde) | La acción se completó | “Tarea creada: “Login” se agregó dentro de “Sprint 1”” |
| Error (rojo) | La acción no se realizó | “No se pudo crear la dependencia: Dependencia circular: A → B → A” |
| Advertencia (ámbar) | Se completó, pero conviene revisar; o faltan datos | “Nuevas alertas de planificación: el fin supera la fecha objetivo” |
| Información (azul) | Contexto neutral | “Sin cambios: no hay modificaciones que guardar” |

### 8.2 Piezas

| Pieza | Uso | Componente |
|---|---|---|
| Notificación | Resultado de una acción; se cierra sola (éxito 4 s, error 12 s) y se pausa al pasar el mouse | `useNotify()` |
| Diálogo de confirmación | Antes de toda eliminación y de cambios de alto impacto (metodología, jornada) | `useDialogs().confirm / choose` |
| Alerta en línea | Estado persistente de una página (API caída, sobreasignación, alertas del cronograma) | `<Alert>` |
| Error de campo | Validación bajo cada control, en vivo después del primer intento de guardado | `<Field error>` |
| Cambios sin guardar | Indicador + confirmación al cerrar, cambiar de pestaña o recargar | `useGuardedClose`, `useUnsavedChanges` |

### 8.3 Reglas

1. **Título = qué se intentó; mensaje = por qué.** Los errores muestran la acción
   (“No se pudo guardar el calendario”) y la causa que devuelve el servidor.
2. **Eliminar siempre pide confirmación** y dice qué se pierde (elementos contenidos,
   asignaciones, dependencias). Si hay dependencias, el mismo diálogo ofrece resolverlas (RN-28).
3. **El botón seguro recibe el foco** en acciones destructivas (Enter no borra por accidente).
4. **Validación doble:** el frontend valida para dar respuesta inmediata; el backend valida
   siempre y responde `{code, message, errors[{field, label, message}]}` en español.
5. **Nunca se pierden ediciones en silencio:** los diálogos y páginas con cambios piden
   confirmar antes de descartarlos.
6. **Acciones reversibles ofrecen “Deshacer”** (p. ej., una dependencia creada al arrastrar).
7. Todos los textos viven en `frontend/src/lib/messages.ts` para mantener el mismo tono.
