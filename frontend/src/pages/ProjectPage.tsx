import { useState } from 'react'
import { NavLink, Route, Routes, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useProject, useProjectMutation } from '../api/hooks'
import type { Project, ProjectInput } from '../api/types'
import { useToast } from '../components/Toast'
import { CalendarView } from '../features/calendar/CalendarView'
import { CpmView } from '../features/cpm/CpmView'
import { PlanView } from '../features/plan/PlanView'
import { ProjectForm } from '../features/projects/ProjectForm'
import { ResourceView } from '../features/resources/ResourceView'
import { TeamView } from '../features/team/TeamView'
import { METHODOLOGY_LABEL } from '../lib/labels'
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
  const { data: project, isLoading, error } = useProject(projectId)

  if (isLoading) return <p className="page muted">Abriendo proyecto…</p>
  if (error || !project) return <p className="page error-text">No se pudo abrir el proyecto: {(error as Error)?.message}</p>

  return (
    <main className="project-page">
      <ProjectHeader project={project} />
      <nav className="tabs">
        {TABS.map(([path, label]) => (
          <NavLink key={path} to={path ? `/projects/${project.id}/${path}` : `/projects/${project.id}`} end>
            {label}
          </NavLink>
        ))}
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
        <div className="warnings">
          <button className="link" onClick={() => setShowWarnings(!showWarnings)}>
            ⚠ {warnings.length} alerta(s) de planificación {showWarnings ? '▴' : '▾'}
          </button>
          {showWarnings && <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        </div>
      )}
    </header>
  )
}

function SettingsView({ project }: { project: Project }) {
  const toast = useToast()
  const save = useProjectMutation(project.id, (input: ProjectInput) => api.updateProject(project.id, input))
  const initial: ProjectInput = {
    name: project.name,
    description: project.description,
    methodology: project.methodology,
    start_date: project.start_date,
    target_date: project.target_date,
    settings: project.settings,
  }
  return (
    <div className="page-section narrow">
      <h2>Configuración del proyecto</h2>
      <p className="muted">
        Cambiar la metodología sólo es posible si la EDT actual cumple sus reglas. Al cambiar las horas por día, las
        duraciones conservan su valor en la unidad elegida (p. ej. “5 días” sigue siendo 5 días).
      </p>
      <ProjectForm key={project.updated_at} initial={initial} submitLabel="Guardar cambios" busy={save.isPending}
        onSubmit={(input) => save.mutate(input, { onSuccess: () => toast.success('Proyecto actualizado') })} />
    </div>
  )
}
