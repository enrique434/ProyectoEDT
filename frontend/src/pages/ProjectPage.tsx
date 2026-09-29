import { useCallback, useState } from 'react'
import { Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useProject, useProjectMutation } from '../api/hooks'
import type { Project, ProjectInput } from '../api/types'
import { Button } from '../components/Button'
import { Alert } from '../components/feedback/Alert'
import { useConfirmLeave, useUnsavedChanges } from '../components/feedback/UnsavedChanges'
import { CalendarView } from '../features/calendar/CalendarView'
import { CpmView } from '../features/cpm/CpmView'
import { PlanView } from '../features/plan/PlanView'
import { ProjectForm } from '../features/projects/ProjectForm'
import { ResourceView } from '../features/resources/ResourceView'
import { TeamView } from '../features/team/TeamView'
import { describeError, isApiError } from '../lib/errors'
import { METHODOLOGY_LABEL } from '../lib/labels'
import { MSG } from '../lib/messages'
import { formatDate, formatDateTime, percent } from '../lib/format'

const TABS: [string, string][] = [
  ['', 'EDT y Gantt'],
  ['cpm', 'Ruta crítica / CPM'],
  ['calendar', 'Calendario'],
  ['team', 'Equipo'],
  ['resources', 'Recursos'],
  ['settings', 'Configuración'],
]

export function ProjectPage() {
  const { projectId = '' } = useParams()
  const { data: project, isLoading, error, refetch, isRefetching } = useProject(projectId)
  const confirmLeave = useConfirmLeave()
  const navigate = useNavigate()

  if (isLoading) return <p className="page muted loading-line"><span className="spinner" /> Abriendo proyecto…</p>
  if (error || !project) {
    const notFound = isApiError(error, 'not_found')
    const { title, message } = describeError(error)
    return (
      <main className="page">
        <Alert tone={notFound ? 'warning' : 'error'} title={notFound ? 'El proyecto no existe' : title}
          action={
            <>
              {!notFound && <Button size="sm" loading={isRefetching} onClick={() => refetch()}>Reintentar</Button>}
              <Link className="btn btn-sm" to="/">Volver a proyectos</Link>
            </>
          }>
          {notFound ? 'Es posible que haya sido eliminado. Vuelva a la lista para abrir otro proyecto.' : message}
        </Alert>
      </main>
    )
  }

  const base = `/projects/${project.id}`
  return (
    <main className="project-page">
      <ProjectHeader project={project} />
      <nav className="tabs">
        {TABS.map(([path, label]) => {
          const to = path ? `${base}/${path}` : base
          return (
            <NavLink key={path} to={to} end onClick={async (e) => {
              e.preventDefault()
              if (await confirmLeave()) navigate(to)
            }}>
              {label}
            </NavLink>
          )
        })}
      </nav>
      <Routes>
        <Route index element={<PlanView project={project} />} />
        <Route path="cpm" element={<CpmView project={project} />} />
        <Route path="calendar" element={<CalendarView key={project.updated_at} project={project} />} />
        <Route path="team" element={<TeamView project={project} />} />
        <Route path="resources" element={<ResourceView project={project} />} />
        <Route path="settings" element={<SettingsView project={project} />} />
      </Routes>
    </main>
  )
}

function ProjectHeader({ project }: { project: Project }) {
  const [showWarnings, setShowWarnings] = useState(false)
  const s = project.schedule
  const late = s && project.target_date && s.finish.slice(0, 10) > project.target_date
  const warnings = s?.warnings ?? []
  return (
    <header className="project-header">
      <div className="project-title">
        <h1>{project.name}</h1>
        <span className={`badge badge-${project.methodology}`}>{METHODOLOGY_LABEL[project.methodology]}</span>
      </div>
      <dl className="stats">
        <div><dt>Inicio</dt><dd>{formatDate(project.start_date)}</dd></div>
        <div><dt>Fin calculado</dt><dd className={late ? 'late' : ''}>{formatDate(s?.finish)}</dd></div>
        <div><dt>Objetivo</dt><dd>{formatDate(project.target_date)}</dd></div>
        <div><dt>Duración</dt><dd>{s ? `${s.duration_days} d` : '—'}</dd></div>
        <div><dt>Críticas</dt><dd>{s?.critical_item_ids.length ?? 0}</dd></div>
        {project.target_date && <div><dt>P(cumplir)</dt><dd>{percent(s?.target_probability)}</dd></div>}
        <div><dt>Recalculado</dt><dd className="small">{formatDateTime(s?.calculated_at)}</dd></div>
      </dl>
      {warnings.length > 0 && (
        <Alert tone="warning" compact
          title={`${warnings.length} alerta(s) de planificación`}
          action={<button className="link" onClick={() => setShowWarnings(!showWarnings)}>{showWarnings ? 'Ocultar' : 'Ver detalle'}</button>}>
          {showWarnings && <ul className="alert-list">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        </Alert>
      )}
    </header>
  )
}

function SettingsView({ project }: { project: Project }) {
  const [dirty, setDirty] = useState(false)
  useUnsavedChanges('project-settings', dirty)
  const onDirtyChange = useCallback((value: boolean) => setDirty(value), [])
  const save = useProjectMutation(project.id, (input: ProjectInput) => api.updateProject(project.id, input), {
    success: () => MSG.projectUpdated,
    error: 'No se pudo guardar la configuración',
  })
  const initial: ProjectInput = {
    name: project.name,
    description: project.description,
    methodology: project.methodology,
    start_date: project.start_date,
    target_date: project.target_date,
    settings: {
      default_time_unit: project.settings.default_time_unit,
      default_task_duration: project.settings.default_task_duration,
      default_sprint_duration: project.settings.default_sprint_duration,
      hours_per_day: project.settings.hours_per_day,
      days_per_week: project.settings.days_per_week,
      days_per_month: project.settings.days_per_month,
    },
  }
  return (
    <div className="page-section narrow">
      <h2>Configuración del proyecto</h2>
      <p className="muted">
        Cambiar la metodología sólo es posible si la EDT actual cumple sus reglas. Al cambiar las horas por día, las
        duraciones conservan su valor en la unidad elegida (p. ej. “5 días” sigue siendo 5 días).
      </p>
      <ProjectForm key={project.updated_at} initial={initial} submitLabel="Guardar cambios" busy={save.isPending}
        onSubmit={(input) => save.mutateAsync(input)} onDirtyChange={onDirtyChange} />
    </div>
  )
}
