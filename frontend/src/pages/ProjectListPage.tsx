import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useProjects } from '../api/hooks'
import type { Methodology, ProjectInput, ProjectListItem } from '../api/types'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { Alert } from '../components/feedback/Alert'
import { useDialogs } from '../components/feedback/Dialogs'
import { useNotify } from '../components/feedback/Notifications'
import { useGuardedClose } from '../components/feedback/UnsavedChanges'
import { ProjectForm } from '../features/projects/ProjectForm'
import { describeError } from '../lib/errors'
import { METHODOLOGY_LABEL } from '../lib/labels'
import { MSG } from '../lib/messages'
import { formatDate, formatDateTime, toIsoDate } from '../lib/format'

export function ProjectListPage() {
  const { data: projects, isLoading, error, refetch, isRefetching } = useProjects()
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()
  const notify = useNotify()
  const dialogs = useDialogs()
  const client = useQueryClient()

  const open = (id: string) => navigate(`/projects/${id}`)
  const create = useMutation({
    mutationFn: (input: ProjectInput) => api.createProject(input),
    onSuccess: (project) => {
      notify.success(MSG.projectCreated(project.name))
      setCreating(false)
      open(project.id)
    },
    onError: (e) => notify.fromError(e, 'No se pudo crear el proyecto'),
  })
  const sample = useMutation({
    mutationFn: (m: Methodology) => api.createSample(m, toIsoDate(new Date())),
    onSuccess: (project) => {
      notify.success(MSG.sampleCreated(project.name))
      open(project.id)
    },
    onError: (e) => notify.fromError(e, 'No se pudo crear el proyecto de ejemplo'),
  })
  const remove = useMutation({
    mutationFn: (p: ProjectListItem) => api.deleteProject(p.id),
    onSuccess: (_, p) => {
      client.invalidateQueries({ queryKey: ['projects'] })
      client.removeQueries({ queryKey: ['project', p.id] })
      notify.success(MSG.projectDeleted(p.name))
    },
    onError: (e, p) => notify.fromError(e, `No se pudo eliminar “${p.name}”`),
  })

  const confirmDelete = async (p: ProjectListItem) => {
    if (await dialogs.confirm({ ...MSG.confirmDeleteProject(p.name, p.item_count), tone: 'danger' })) remove.mutate(p)
  }

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1>Proyectos</h1>
          <p className="muted">Cada proyecto conserva su propio calendario, equipo, EDT, dependencias y cronograma.</p>
        </div>
        <div className="actions">
          <div className="dropdown">
            <Button loading={sample.isPending} loadingText="Creando ejemplo…">Crear ejemplo ▾</Button>
            {!sample.isPending && (
              <div className="dropdown-menu">
                {(['traditional', 'agile', 'hybrid'] as Methodology[]).map((m) => (
                  <button key={m} onClick={() => sample.mutate(m)}>Proyecto {METHODOLOGY_LABEL[m].toLowerCase()}</button>
                ))}
              </div>
            )}
          </div>
          <Button variant="primary" onClick={() => setCreating(true)}>+ Nuevo proyecto</Button>
        </div>
      </div>

      {isLoading && <p className="muted loading-line"><span className="spinner" /> Cargando proyectos…</p>}
      {error && (
        <Alert tone="error" title={describeError(error).title}
          action={<Button size="sm" loading={isRefetching} onClick={() => refetch()}>Reintentar</Button>}>
          {describeError(error).message}
        </Alert>
      )}
      {projects && projects.length === 0 && (
        <div className="empty">
          <h2>Aún no hay proyectos</h2>
          <p>Cree uno desde cero o genere un proyecto de ejemplo para ver el ciclo completo: EDT → PERT → CPM → Gantt.</p>
          <Button variant="primary" onClick={() => setCreating(true)}>+ Nuevo proyecto</Button>
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
            {projects.map((p) => {
              const late = p.finish && p.target_date && p.finish.slice(0, 10) > p.target_date
              return (
                <tr key={p.id} className="clickable" onClick={() => open(p.id)}>
                  <td>
                    <strong>{p.name}</strong>
                    {p.description && <div className="muted small">{p.description}</div>}
                  </td>
                  <td><span className={`badge badge-${p.methodology}`}>{METHODOLOGY_LABEL[p.methodology]}</span></td>
                  <td>{formatDate(p.start_date)}</td>
                  <td className={late ? 'late' : ''} title={late ? 'Supera la fecha objetivo' : undefined}>
                    {formatDate(p.finish)}{late && ' ⚠'}
                  </td>
                  <td>{formatDate(p.target_date)}</td>
                  <td className="num">{p.item_count}</td>
                  <td className="small">{formatDateTime(p.updated_at)}</td>
                  <td>
                    <button className="icon-btn danger" title={`Eliminar “${p.name}”`} aria-label={`Eliminar ${p.name}`}
                      disabled={remove.isPending && remove.variables?.id === p.id}
                      onClick={(e) => { e.stopPropagation(); confirmDelete(p) }}>
                      🗑
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {creating && <CreateProjectDialog busy={create.isPending} onSubmit={(input) => create.mutateAsync(input)}
        onClose={() => setCreating(false)} />}
    </main>
  )
}

function CreateProjectDialog({ busy, onSubmit, onClose }: {
  busy: boolean
  onSubmit: (input: ProjectInput) => Promise<unknown>
  onClose: () => void
}) {
  const [dirty, setDirty] = useState(false)
  const close = useGuardedClose(dirty && !busy, onClose)
  return (
    <Modal title="Nuevo proyecto" onClose={close} wide>
      <ProjectForm submitLabel="Crear proyecto" busy={busy} onSubmit={onSubmit} onCancel={close} onDirtyChange={setDirty} />
    </Modal>
  )
}
