import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useProjects } from '../api/hooks'
import type { Methodology, ProjectInput } from '../api/types'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { ProjectForm } from '../features/projects/ProjectForm'
import { METHODOLOGY_LABEL } from '../lib/labels'
import { formatDate, formatDateTime, toIsoDate } from '../lib/format'

export function ProjectListPage() {
  const { data: projects, isLoading, error } = useProjects()
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()
  const client = useQueryClient()

  const open = (id: string) => navigate(`/projects/${id}`)
  const create = useMutation({
    mutationFn: (input: ProjectInput) => api.createProject(input),
    onSuccess: (project) => open(project.id),
    onError: (e: Error) => toast.error(e.message),
  })
  const sample = useMutation({
    mutationFn: (m: Methodology) => api.createSample(m, toIsoDate(new Date())),
    onSuccess: (project) => open(project.id),
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['projects'] })
      toast.success('Proyecto eliminado')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1>Proyectos</h1>
          <p className="muted">Cada proyecto conserva su propio calendario, equipo, EDT, dependencias y cronograma.</p>
        </div>
        <div className="actions">
          <div className="dropdown">
            <button className="btn">Crear ejemplo ▾</button>
            <div className="dropdown-menu">
              {(['traditional', 'agile', 'hybrid'] as Methodology[]).map((m) => (
                <button key={m} onClick={() => sample.mutate(m)} disabled={sample.isPending}>
                  Proyecto {METHODOLOGY_LABEL[m].toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Nuevo proyecto</button>
        </div>
      </div>

      {isLoading && <p className="muted">Cargando…</p>}
      {error && <p className="error-text">No se pudo conectar con la API: {(error as Error).message}</p>}
      {projects && projects.length === 0 && (
        <div className="empty">
          <h2>Aún no hay proyectos</h2>
          <p>Crea uno desde cero o genera un proyecto de ejemplo para ver el ciclo completo: EDT → PERT → CPM → Gantt.</p>
        </div>
      )}
      {projects && projects.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Metodología</th>
              <th>Inicio</th>
              <th>Fin calculado</th>
              <th>Objetivo</th>
              <th className="num">Actividades</th>
              <th>Modificado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => open(p.id)}>
                <td>
                  <strong>{p.name}</strong>
                  {p.description && <div className="muted small">{p.description}</div>}
                </td>
                <td><span className={`badge badge-${p.methodology}`}>{METHODOLOGY_LABEL[p.methodology]}</span></td>
                <td>{formatDate(p.start_date)}</td>
                <td>{formatDate(p.finish)}</td>
                <td>{formatDate(p.target_date)}</td>
                <td className="num">{p.item_count}</td>
                <td className="small">{formatDateTime(p.updated_at)}</td>
                <td>
                  <button className="icon-btn danger" title="Eliminar proyecto"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`¿Eliminar definitivamente "${p.name}"?`)) remove.mutate(p.id)
                    }}>
                    🗑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {creating && (
        <Modal title="Nuevo proyecto" onClose={() => setCreating(false)} wide>
          <ProjectForm submitLabel="Crear proyecto" busy={create.isPending} onSubmit={(input) => create.mutate(input)}
            onCancel={() => setCreating(false)} />
        </Modal>
      )}
    </main>
  )
}
