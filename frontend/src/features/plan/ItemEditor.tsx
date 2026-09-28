import { useMemo, useState } from 'react'
import { api } from '../../api/client'
import { useProjectMutation } from '../../api/hooks'
import type {
  ConstraintType,
  DependencyType,
  EstimationMode,
  ItemStatus,
  ItemUpdateInput,
  Priority,
  Project,
  TimeUnit,
  WorkItem,
  WorkItemKind,
} from '../../api/types'
import { Modal } from '../../components/Modal'
import { useToast } from '../../components/Toast'
import {
  CONSTRAINT_LABEL,
  DEPENDENCY_LABEL,
  ESTIMATION_LABEL,
  KIND_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  UNIT_LABEL,
} from '../../lib/labels'
import { formatDateTime, formatDays, formatLag, round } from '../../lib/format'
import { allowedChildren, descendantIds } from '../../lib/wbs'

type Tab = 'general' | 'duration' | 'dates' | 'dependencies' | 'resources'
const TABS: [Tab, string][] = [
  ['general', 'General'],
  ['duration', 'Duración / PERT'],
  ['dates', 'Fechas y CPM'],
  ['dependencies', 'Dependencias'],
  ['resources', 'Recursos'],
]
const UNITS: TimeUnit[] = ['hour', 'day', 'week', 'month']
const DEP_TYPES: DependencyType[] = ['FS', 'SS', 'FF', 'SF']

interface Props {
  project: Project
  item: WorkItem
  onClose: () => void
}

export function ItemEditor({ project, item, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('general')
  return (
    <Modal title={`${item.wbs_code} · ${item.name}`} onClose={onClose} wide>
      <nav className="tabs small-tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>
      {(tab === 'general' || tab === 'duration' || tab === 'dates') && (
        <DetailsForm key={item.id} project={project} item={item} tab={tab} onSaved={onClose} />
      )}
      {tab === 'dependencies' && <DependenciesTab project={project} item={item} />}
      {tab === 'resources' && <ResourcesTab project={project} item={item} />}
    </Modal>
  )
}

// ------------------------------------------------------------------------ details
interface DetailsState {
  name: string
  kind: WorkItemKind
  parentId: string
  description: string
  objective: string
  status: ItemStatus
  priority: Priority
  progress: number
  mode: EstimationMode
  durationValue: number
  unit: TimeUnit
  optimistic: number
  mostLikely: number
  pessimistic: number
  constraintType: ConstraintType
  constraintDate: string
}

function DetailsForm({ project, item, tab, onSaved }: { project: Project; item: WorkItem; tab: Tab; onSaved: () => void }) {
  const [s, setS] = useState<DetailsState>(() => ({
    name: item.name,
    kind: item.kind,
    parentId: item.parent_id ?? '',
    description: item.description,
    objective: item.objective,
    status: item.status,
    priority: item.priority,
    progress: item.progress,
    mode: item.estimation_mode,
    durationValue: item.duration_value,
    unit: item.duration_unit,
    optimistic: item.pert?.optimistic ?? item.duration_value,
    mostLikely: item.pert?.most_likely ?? item.duration_value,
    pessimistic: item.pert?.pessimistic ?? item.duration_value,
    constraintType: item.constraint_type,
    constraintDate: item.constraint_date ?? '',
  }))
  const set = <K extends keyof DetailsState>(key: K, value: DetailsState[K]) => setS((prev) => ({ ...prev, [key]: value }))
  const update = useProjectMutation(project.id, (input: ItemUpdateInput) => api.updateItem(project.id, item.id, input))
  const move = useProjectMutation(project.id, (parentId: string | null) => api.moveItem(project.id, item.id, parentId, null))
  const toast = useToast()

  const byId = useMemo(() => new Map(project.items.map((i) => [i.id, i])), [project.items])
  const parent = item.parent_id ? byId.get(item.parent_id) ?? null : null
  const kindOptions = allowedChildren(project, parent).filter((k) => !item.is_summary || k !== 'milestone')
  const containers = useMemo(() => {
    const excluded = descendantIds(project.items, item.id)
    return project.items.filter((c) => !excluded.has(c.id) && allowedChildren(project, c).includes(s.kind))
  }, [project, item.id, s.kind])
  const rootAllowed = allowedChildren(project, null).includes(s.kind)

  const isMilestone = s.kind === 'milestone'
  const durationEditable = !isMilestone && (!item.is_summary || item.kind === 'sprint')
  const pertValid = s.optimistic <= s.mostLikely && s.mostLikely <= s.pessimistic && s.optimistic >= 0
  const te = (s.optimistic + 4 * s.mostLikely + s.pessimistic) / 6
  const sigma = (s.pessimistic - s.optimistic) / 6

  const save = async () => {
    if (s.mode === 'pert' && durationEditable && !pertValid) {
      toast.error('PERT requiere Optimista ≤ Más probable ≤ Pesimista')
      return
    }
    if (s.constraintType !== 'asap' && !s.constraintDate) {
      toast.error('Seleccione la fecha de la restricción')
      return
    }
    const input: ItemUpdateInput = {
      name: s.name,
      kind: s.kind,
      description: s.description,
      objective: s.objective,
      priority: s.priority,
      constraint_type: s.constraintType,
      constraint_date: s.constraintType === 'asap' ? null : s.constraintDate,
    }
    if (!item.is_summary) {
      input.status = s.status
      input.progress = s.progress
    }
    if (durationEditable) {
      input.estimation_mode = s.mode
      input.duration_unit = s.unit
      if (s.mode === 'manual') input.duration_value = s.durationValue
      else input.pert = { optimistic: s.optimistic, most_likely: s.mostLikely, pessimistic: s.pessimistic }
    }
    try {
      if ((s.parentId || null) !== item.parent_id) await move.mutateAsync(s.parentId || null)
      await update.mutateAsync(input)
      toast.success('Actividad actualizada y cronograma recalculado')
      onSaved()
    } catch {
      /* the mutation hook already shows the error */
    }
  }

  const sched = item.schedule
  const mpd = project.settings.minutes_per_day

  return (
    <div className="form">
      {tab === 'general' && (
        <>
          <div className="grid-2">
            <label className="field"><span>Nombre *</span>
              <input value={s.name} maxLength={200} onChange={(e) => set('name', e.target.value)} autoFocus />
            </label>
            <label className="field"><span>Tipo</span>
              <select value={s.kind} onChange={(e) => set('kind', e.target.value as WorkItemKind)}>
                {[...new Set([item.kind, ...kindOptions])].map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </label>
          </div>
          <label className="field"><span>Contenedor (jerarquía)</span>
            <select value={s.parentId} onChange={(e) => set('parentId', e.target.value)}>
              {(rootAllowed || !item.parent_id) && <option value="">— Raíz del proyecto —</option>}
              {containers.map((c) => (
                <option key={c.id} value={c.id}>{`${'  '.repeat(c.level)}${c.wbs_code} ${c.name} (${KIND_LABEL[c.kind]})`}</option>
              ))}
            </select>
          </label>
          {(s.kind === 'sprint' || s.kind === 'story') && (
            <label className="field"><span>{s.kind === 'sprint' ? 'Objetivo del sprint' : 'Criterio / objetivo'}</span>
              <input value={s.objective} onChange={(e) => set('objective', e.target.value)} />
            </label>
          )}
          <label className="field"><span>Descripción</span>
            <textarea rows={2} value={s.description} onChange={(e) => set('description', e.target.value)} />
          </label>
          <div className="grid-3">
            <label className="field"><span>Estado</span>
              <select value={s.status} disabled={item.is_summary}
                onChange={(e) => {
                  const status = e.target.value as ItemStatus
                  setS((p) => ({ ...p, status, progress: status === 'completed' ? 100 : status === 'not_started' ? 0 : p.progress }))
                }}>
                {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="field"><span>Prioridad</span>
              <select value={s.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
                {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="field"><span>Avance: {s.progress}%</span>
              <input type="range" min={0} max={100} step={5} value={s.progress} disabled={item.is_summary}
                onChange={(e) => {
                  const progress = Number(e.target.value)
                  setS((p) => ({ ...p, progress, status: progress === 100 ? 'completed' : progress > 0 && p.status === 'not_started' ? 'in_progress' : p.status }))
                }} />
            </label>
          </div>
          {item.is_summary && <p className="hint">El estado y el avance de un resumen se calculan a partir de sus hijos (ponderado por duración).</p>}
        </>
      )}

      {tab === 'duration' && (
        <>
          {isMilestone && <p className="hint">Un hito tiene duración cero (RN-19).</p>}
          {item.is_summary && item.kind !== 'sprint' && (
            <p className="hint">La duración de un elemento resumen se deriva de sus hijos: {sched ? formatDays(sched.early_finish - sched.early_start, mpd) : '—'}.</p>
          )}
          {item.is_summary && item.kind === 'sprint' && (
            <p className="hint">En un sprint la duración es su <strong>timebox</strong>: el sprint dura al menos esto aunque sus tareas terminen antes.</p>
          )}
          {durationEditable && (
            <>
              <div className="segmented">
                {(['manual', 'pert'] as EstimationMode[]).map((m) => (
                  <button key={m} className={s.mode === m ? 'active' : ''} onClick={() => set('mode', m)}>{ESTIMATION_LABEL[m]}</button>
                ))}
              </div>
              <label className="field"><span>Unidad</span>
                <select value={s.unit} onChange={(e) => set('unit', e.target.value as TimeUnit)}>
                  {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
                </select>
              </label>
              {s.mode === 'manual' ? (
                <label className="field"><span>Duración ({UNIT_LABEL[s.unit]})</span>
                  <input type="number" min={0} step={0.5} value={s.durationValue} onChange={(e) => set('durationValue', Number(e.target.value))} />
                </label>
              ) : (
                <>
                  <div className="grid-3">
                    <label className="field"><span>Optimista (O)</span>
                      <input type="number" min={0} step={0.5} value={s.optimistic} onChange={(e) => set('optimistic', Number(e.target.value))} />
                    </label>
                    <label className="field"><span>Más probable (M)</span>
                      <input type="number" min={0} step={0.5} value={s.mostLikely} onChange={(e) => set('mostLikely', Number(e.target.value))} />
                    </label>
                    <label className="field"><span>Pesimista (P)</span>
                      <input type="number" min={0} step={0.5} value={s.pessimistic} onChange={(e) => set('pessimistic', Number(e.target.value))} />
                    </label>
                  </div>
                  <div className={`pert-box ${pertValid ? '' : 'invalid'}`}>
                    {pertValid ? (
                      <>
                        <div>TE = (O + 4M + P) / 6 = ({s.optimistic} + 4·{s.mostLikely} + {s.pessimistic}) / 6 = <strong>{round(te)} {UNIT_LABEL[s.unit]}</strong></div>
                        <div>σ = (P − O) / 6 = {round(sigma)} · varianza = {round(sigma * sigma)}</div>
                        <div className="muted small">TE se usará como duración planificada (RN-18).</div>
                      </>
                    ) : 'Debe cumplirse O ≤ M ≤ P (RN-17)'}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {tab === 'dates' && (
        <>
          <div className="grid-2">
            <label className="field"><span>Restricción de fecha</span>
              <select value={s.constraintType} onChange={(e) => set('constraintType', e.target.value as ConstraintType)}>
                {Object.entries(CONSTRAINT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="field"><span>Fecha de la restricción</span>
              <input type="date" disabled={s.constraintType === 'asap'} value={s.constraintDate}
                onChange={(e) => set('constraintDate', e.target.value)} />
            </label>
          </div>
          <p className="hint">Las fechas manuales (restricciones) se guardan separadas de las fechas calculadas (RN-27).</p>
          {sched && (
            <table className="table compact">
              <tbody>
                <tr><th>Inicio calculado</th><td>{formatDateTime(sched.start)}</td><th>Fin calculado</th><td>{formatDateTime(sched.finish)}</td></tr>
                <tr><th>ES (inicio temprano)</th><td>{formatDays(sched.early_start, mpd)}</td><th>EF (fin temprano)</th><td>{formatDays(sched.early_finish, mpd)}</td></tr>
                <tr><th>LS (inicio tardío)</th><td>{formatDays(sched.late_start, mpd)}</td><th>LF (fin tardío)</th><td>{formatDays(sched.late_finish, mpd)}</td></tr>
                <tr><th>Holgura total</th><td>{formatDays(sched.total_float, mpd)}</td><th>Holgura libre</th><td>{formatDays(sched.free_float, mpd)}</td></tr>
                <tr><th>¿Crítica?</th><td colSpan={3}>{sched.is_critical ? <span className="badge badge-critical">Sí · pertenece a la ruta crítica</span> : 'No'}</td></tr>
              </tbody>
            </table>
          )}
        </>
      )}

      <div className="form-actions">
        <button className="btn btn-primary" onClick={save} disabled={update.isPending || move.isPending}>
          {update.isPending ? 'Guardando…' : 'Guardar y recalcular'}
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ dependencies
function DependenciesTab({ project, item }: { project: Project; item: WorkItem }) {
  const byId = useMemo(() => new Map(project.items.map((i) => [i.id, i])), [project.items])
  const predecessors = project.dependencies.filter((d) => d.successor_id === item.id)
  const successors = project.dependencies.filter((d) => d.predecessor_id === item.id)
  const related = useMemo(() => {
    const ancestors = new Set<string>()
    let current = item.parent_id
    while (current) {
      ancestors.add(current)
      current = byId.get(current)?.parent_id ?? null
    }
    const descendants = descendantIds(project.items, item.id)
    return new Set([...ancestors, ...descendants])
  }, [project.items, item, byId])
  const candidates = project.items.filter((i) => !related.has(i.id) && !predecessors.some((d) => d.predecessor_id === i.id))

  const [draft, setDraft] = useState({ predecessorId: '', type: 'FS' as DependencyType, lag: 0, unit: 'day' as TimeUnit })
  const create = useProjectMutation(project.id, () =>
    api.createDependency(project.id, { predecessor_id: draft.predecessorId, successor_id: item.id, type: draft.type, lag_value: draft.lag, lag_unit: draft.unit }))
  const updateDep = useProjectMutation(project.id, (a: { id: string; type: DependencyType; lag: number; unit: TimeUnit }) =>
    api.updateDependency(project.id, a.id, a.type, a.lag, a.unit))
  const remove = useProjectMutation(project.id, (id: string) => api.deleteDependency(project.id, id))

  const label = (id: string) => {
    const i = byId.get(id)
    return i ? `${i.row} · ${i.wbs_code} ${i.name}` : '?'
  }

  return (
    <div className="form">
      <h3>Predecesoras de “{item.name}”</h3>
      {predecessors.length === 0 && <p className="muted">Sin predecesoras: comienza tan pronto como su contenedor lo permita.</p>}
      {predecessors.length > 0 && (
        <table className="table compact">
          <thead><tr><th>Actividad</th><th>Tipo</th><th>Lag (+) / Lead (−)</th><th /></tr></thead>
          <tbody>
            {predecessors.map((d) => (
              <tr key={d.id}>
                <td>{label(d.predecessor_id)}</td>
                <td>
                  <select value={d.type} onChange={(e) => updateDep.mutate({ id: d.id, type: e.target.value as DependencyType, lag: d.lag_value, unit: d.lag_unit })}>
                    {DEP_TYPES.map((t) => <option key={t} value={t}>{DEPENDENCY_LABEL[t]}</option>)}
                  </select>
                </td>
                <td>
                  <div className="input-group">
                    <input type="number" step={0.5} defaultValue={d.lag_value} key={`${d.id}-${d.lag_value}`}
                      onBlur={(e) => Number(e.target.value) !== d.lag_value && updateDep.mutate({ id: d.id, type: d.type, lag: Number(e.target.value), unit: d.lag_unit })} />
                    <select value={d.lag_unit} onChange={(e) => updateDep.mutate({ id: d.id, type: d.type, lag: d.lag_value, unit: e.target.value as TimeUnit })}>
                      {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
                    </select>
                  </div>
                </td>
                <td><button className="icon-btn danger" title="Eliminar dependencia" onClick={() => remove.mutate(d.id)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="add-dependency">
        <select value={draft.predecessorId} onChange={(e) => setDraft({ ...draft, predecessorId: e.target.value })}>
          <option value="">— Agregar predecesora —</option>
          {candidates.map((c) => <option key={c.id} value={c.id}>{label(c.id)}</option>)}
        </select>
        <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as DependencyType })}>
          {DEP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="number" step={0.5} value={draft.lag} title="Lag positivo = retraso; negativo = adelanto (lead)"
          onChange={(e) => setDraft({ ...draft, lag: Number(e.target.value) })} />
        <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value as TimeUnit })}>
          {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
        </select>
        <button className="btn btn-primary" disabled={!draft.predecessorId || create.isPending}
          onClick={() => create.mutate(undefined, { onSuccess: () => setDraft({ ...draft, predecessorId: '', lag: 0 }) })}>
          Agregar
        </button>
      </div>
      <p className="hint">Se rechazan autodependencias, duplicados y ciclos (A → B → C → A), incluidos los que se forman a través de la jerarquía.</p>

      <h3>Sucesoras</h3>
      {successors.length === 0 ? <p className="muted">Ninguna.</p> : (
        <ul className="plain-list">
          {successors.map((d) => (
            <li key={d.id}>
              {label(d.successor_id)} <span className="badge">{d.type}{formatLag(d.lag_value, d.lag_unit)}</span>
              <button className="icon-btn danger" onClick={() => remove.mutate(d.id)} title="Eliminar">✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// --------------------------------------------------------------------- resources
function ResourcesTab({ project, item }: { project: Project; item: WorkItem }) {
  const initial = new Map(item.assignments.map((a) => [a.member_id, a.units]))
  const [selection, setSelection] = useState<Map<string, number>>(initial)
  const save = useProjectMutation(project.id, () =>
    api.setAssignments(project.id, item.id, [...selection].map(([member_id, units]) => ({ member_id, units }))))
  const toast = useToast()
  const roles = new Map(project.roles.map((r) => [r.id, r.name]))

  const toggle = (id: string) => {
    const next = new Map(selection)
    if (next.has(id)) next.delete(id)
    else next.set(id, 100)
    setSelection(next)
  }

  if (project.members.length === 0) return <p className="muted">Registre integrantes en la pestaña “Equipo” para poder asignarlos.</p>
  return (
    <div className="form">
      {item.is_summary && <p className="hint">Es un elemento resumen: la carga de trabajo se calcula sobre sus hijos.</p>}
      <table className="table compact">
        <thead><tr><th /><th>Integrante</th><th>Rol</th><th>Disponibilidad</th><th>Dedicación</th></tr></thead>
        <tbody>
          {project.members.map((m) => (
            <tr key={m.id} className={m.active ? '' : 'inactive'}>
              <td><input type="checkbox" checked={selection.has(m.id)} onChange={() => toggle(m.id)} /></td>
              <td>{m.name}{!m.active && ' (inactivo)'}</td>
              <td>{m.role_id ? roles.get(m.role_id) : '—'}</td>
              <td>{m.hours_per_day} h/día</td>
              <td>
                <input type="number" min={1} max={100} step={5} disabled={!selection.has(m.id)} value={selection.get(m.id) ?? 100}
                  onChange={(e) => setSelection(new Map(selection).set(m.id, Math.min(100, Math.max(1, Number(e.target.value)))))} /> %
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-actions">
        <button className="btn btn-primary" disabled={save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: () => toast.success('Responsables actualizados') })}>
          Guardar responsables
        </button>
      </div>
    </div>
  )
}
