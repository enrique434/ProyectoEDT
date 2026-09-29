import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import { useProjectMutation } from '../../api/hooks'
import type {
  ConstraintType,
  Dependency,
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
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { Alert } from '../../components/feedback/Alert'
import { useDialogs } from '../../components/feedback/Dialogs'
import { useNotify } from '../../components/feedback/Notifications'
import { useGuardedClose } from '../../components/feedback/UnsavedChanges'
import { Field, InlineError } from '../../components/form/Field'
import { describeError } from '../../lib/errors'
import {
  CONSTRAINT_LABEL,
  DEPENDENCY_LABEL,
  ESTIMATION_LABEL,
  KIND_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  UNIT_LABEL,
} from '../../lib/labels'
import { MSG, dependencyText } from '../../lib/messages'
import { formatDateTime, formatDays, formatLag, round } from '../../lib/format'
import { errorList, first, hasErrors, rules, sameValues, useValidation, type Errors } from '../../lib/validation'
import { allowedChildren, descendantIds } from '../../lib/wbs'

type Tab = 'general' | 'duration' | 'dates' | 'dependencies' | 'resources'
const TABS: [Tab, string][] = [
  ['general', 'General'],
  ['duration', 'Duración / PERT'],
  ['dates', 'Fechas y CPM'],
  ['dependencies', 'Dependencias'],
  ['resources', 'Recursos'],
]
const DETAIL_TABS: Tab[] = ['general', 'duration', 'dates']
const UNITS: TimeUnit[] = ['hour', 'day', 'week', 'month']
const DEP_TYPES: DependencyType[] = ['FS', 'SS', 'FF', 'SF']

interface Props {
  project: Project
  item: WorkItem
  onClose: () => void
}

export function ItemEditor({ project, item, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('general')
  const [dirtyTabs, setDirtyTabs] = useState<Set<Tab>>(new Set())
  const [resourcesDirty, setResourcesDirty] = useState(false)
  const [errorTabs, setErrorTabs] = useState<Set<Tab>>(new Set())
  const close = useGuardedClose(dirtyTabs.size > 0 || resourcesDirty, onClose)

  return (
    <Modal title={`${item.wbs_code} · ${item.name}`} onClose={close} wide>
      <nav className="tabs small-tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {label}
            {errorTabs.has(key) && <span className="tab-error-dot" title="Esta pestaña tiene datos por corregir" />}
            {((dirtyTabs.has(key) && !errorTabs.has(key)) || (key === 'resources' && resourcesDirty)) &&
              <span className="tab-dirty-dot" title="Cambios sin guardar" />}
          </button>
        ))}
      </nav>
      {/* Every tab stays mounted: switching tabs never loses edits. */}
      <div hidden={!DETAIL_TABS.includes(tab)}>
        <DetailsForm project={project} item={item} tab={tab} onSaved={onClose} onCancel={close} onTabChange={setTab}
          onDirtyTabsChange={setDirtyTabs} onErrorTabsChange={setErrorTabs} />
      </div>
      <div hidden={tab !== 'dependencies'}><DependenciesTab project={project} item={item} /></div>
      <div hidden={tab !== 'resources'}>
        <ResourcesTab project={project} item={item} onDirtyChange={setResourcesDirty} onCancel={close} />
      </div>
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

/** Tab where each field (and each validation error) lives. */
const FIELD_TAB: Record<string, Tab> = {
  name: 'general', kind: 'general', parentId: 'general', description: 'general', objective: 'general',
  status: 'general', priority: 'general', progress: 'general',
  mode: 'duration', durationValue: 'duration', unit: 'duration', optimistic: 'duration', mostLikely: 'duration',
  pessimistic: 'duration', pert: 'duration',
  constraintType: 'dates', constraintDate: 'dates',
}

/** Stable "general,duration" key: lets effects compare sets of tabs by value. */
function tabKey(keys: string[]): string {
  return [...new Set(keys.map((k) => FIELD_TAB[k] ?? 'general'))].sort().join(',')
}
const tabsOf = (key: string) => new Set((key ? key.split(',') : []) as Tab[])
const FIELD_LABEL: Record<string, string> = {
  name: 'Nombre', durationValue: 'Duración', optimistic: 'Optimista (O)', mostLikely: 'Más probable (M)',
  pessimistic: 'Pesimista (P)', pert: 'PERT', constraintDate: 'Fecha de la restricción',
}

function initialDetails(item: WorkItem): DetailsState {
  return {
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
  }
}

function DetailsForm({ project, item, tab, onSaved, onCancel, onTabChange, onDirtyTabsChange, onErrorTabsChange }: {
  project: Project
  item: WorkItem
  tab: Tab
  onSaved: () => void
  onCancel: () => void
  onTabChange: (tab: Tab) => void
  onDirtyTabsChange: (tabs: Set<Tab>) => void
  onErrorTabsChange: (tabs: Set<Tab>) => void
}) {
  const [initial] = useState(() => initialDetails(item))
  const [s, setS] = useState<DetailsState>(initial)
  const set = <K extends keyof DetailsState>(key: K, value: DetailsState[K]) => setS((prev) => ({ ...prev, [key]: value }))
  const notify = useNotify()
  const update = useProjectMutation(project.id, (input: ItemUpdateInput) => api.updateItem(project.id, item.id, input), {
    success: (updated) => MSG.itemUpdated(updated.items.find((i) => i.id === item.id) ?? item),
    error: `No se pudieron guardar los cambios de “${item.name}”`,
  })
  const move = useProjectMutation(project.id, (parentId: string | null) => api.moveItem(project.id, item.id, parentId, null), {
    error: `No se pudo mover “${item.name}” al nuevo contenedor`,
  })

  const isMilestone = s.kind === 'milestone'
  const durationEditable = !isMilestone && (!item.is_summary || item.kind === 'sprint')
  const validate = useCallback((v: DetailsState): Errors => {
    const pertOrder = v.optimistic <= v.mostLikely && v.mostLikely <= v.pessimistic
    const usesPert = durationEditable && v.mode === 'pert'
    return {
      name: first(rules.required(v.name), rules.maxLength(v.name.trim(), 200)),
      durationValue: durationEditable && v.mode === 'manual' ? rules.min(v.durationValue, 0) : undefined,
      optimistic: usesPert ? rules.min(v.optimistic, 0) : undefined,
      mostLikely: usesPert ? rules.min(v.mostLikely, 0) : undefined,
      pessimistic: usesPert ? rules.min(v.pessimistic, 0) : undefined,
      pert: usesPert && !pertOrder ? 'Debe cumplirse Optimista ≤ Más probable ≤ Pesimista (RN-17).' : undefined,
      constraintDate: v.constraintType !== 'asap' && !v.constraintDate ? 'Seleccione la fecha de la restricción.' : undefined,
    }
  }, [durationEditable])
  const { errors, attempt, setServerErrors } = useValidation(s, validate)

  const dirtyTabKey = tabKey((Object.keys(s) as (keyof DetailsState)[]).filter((k) => s[k] !== initial[k]))
  const dirty = dirtyTabKey !== ''
  useLayoutEffect(() => onDirtyTabsChange(tabsOf(dirtyTabKey)), [dirtyTabKey, onDirtyTabsChange])
  const errorTabKey = tabKey(Object.keys(errors).filter((k) => errors[k]))
  useLayoutEffect(() => onErrorTabsChange(tabsOf(errorTabKey)), [errorTabKey, onErrorTabsChange])

  const byId = useMemo(() => new Map(project.items.map((i) => [i.id, i])), [project.items])
  const parent = item.parent_id ? byId.get(item.parent_id) ?? null : null
  const kindOptions = allowedChildren(project, parent).filter((k) => !item.is_summary || k !== 'milestone')
  const containers = useMemo(() => {
    const excluded = descendantIds(project.items, item.id)
    return project.items.filter((c) => !excluded.has(c.id) && allowedChildren(project, c).includes(s.kind))
  }, [project, item.id, s.kind])
  const rootAllowed = allowedChildren(project, null).includes(s.kind)
  const te = (s.optimistic + 4 * s.mostLikely + s.pessimistic) / 6
  const sigma = (s.pessimistic - s.optimistic) / 6

  const save = async () => {
    if (!attempt()) {
      const current = validate(s)
      const firstField = Object.keys(current).find((k) => current[k])
      if (firstField) onTabChange(FIELD_TAB[firstField] ?? 'general')
      notify.warning(MSG.fixFields(errorList(current, FIELD_LABEL)))
      return
    }
    if (!dirty) {
      notify.info(MSG.noChanges)
      onSaved()
      return
    }
    const input: ItemUpdateInput = {
      name: s.name.trim(),
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
      onSaved()
    } catch (error) {
      setServerErrors(describeError(error).fields) // notification already shown by the mutation
    }
  }

  const sched = item.schedule
  const mpd = project.settings.minutes_per_day

  return (
    <div className="form">
      {tab === 'general' && (
        <>
          <div className="grid-2">
            <Field label="Nombre" required error={errors.name}>
              <input value={s.name} maxLength={200} onChange={(e) => set('name', e.target.value)} autoFocus />
            </Field>
            <Field label="Tipo" hint={item.is_summary ? 'Solo tipos que puedan contener a sus hijos actuales.' : undefined}>
              <select value={s.kind} onChange={(e) => set('kind', e.target.value as WorkItemKind)}>
                {[...new Set([item.kind, ...kindOptions])].map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Contenedor (jerarquía)" hint="Mover el elemento cambia su código EDT y puede cambiar sus fechas.">
            <select value={s.parentId} onChange={(e) => set('parentId', e.target.value)}>
              {(rootAllowed || !item.parent_id) && <option value="">— Raíz del proyecto —</option>}
              {containers.map((c) => (
                <option key={c.id} value={c.id}>{`${'  '.repeat(c.level)}${c.wbs_code} ${c.name} (${KIND_LABEL[c.kind]})`}</option>
              ))}
            </select>
          </Field>
          {(s.kind === 'sprint' || s.kind === 'story') && (
            <Field label={s.kind === 'sprint' ? 'Objetivo del sprint' : 'Criterio / objetivo'}>
              <input value={s.objective} onChange={(e) => set('objective', e.target.value)} />
            </Field>
          )}
          <Field label="Descripción">
            <textarea rows={2} value={s.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <div className="grid-3">
            <Field label="Estado">
              <select value={s.status} disabled={item.is_summary}
                onChange={(e) => {
                  const status = e.target.value as ItemStatus
                  setS((p) => ({ ...p, status, progress: status === 'completed' ? 100 : status === 'not_started' ? 0 : p.progress }))
                }}>
                {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Prioridad">
              <select value={s.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
                {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label={`Avance: ${s.progress}%`} hint={s.progress === 100 ? 'Al 100 % la actividad pasa a “Completada” (RN-21).' : undefined}>
              <input type="range" min={0} max={100} step={5} value={s.progress} disabled={item.is_summary}
                onChange={(e) => {
                  const progress = Number(e.target.value)
                  setS((p) => ({ ...p, progress, status: progress === 100 ? 'completed' : progress > 0 && p.status === 'not_started' ? 'in_progress' : p.status === 'completed' ? 'in_progress' : p.status }))
                }} />
            </Field>
          </div>
          {item.is_summary && (
            <Alert tone="info" compact>El estado y el avance de un resumen se calculan a partir de sus hijos (ponderado por duración).</Alert>
          )}
        </>
      )}

      {tab === 'duration' && (
        <>
          {isMilestone && <Alert tone="info" compact>Un hito tiene duración cero (RN-19).</Alert>}
          {item.is_summary && item.kind !== 'sprint' && (
            <Alert tone="info" compact>
              La duración de un elemento resumen se deriva de sus hijos: <strong>{sched ? formatDays(sched.early_finish - sched.early_start, mpd) : '—'}</strong>.
            </Alert>
          )}
          {item.is_summary && item.kind === 'sprint' && (
            <Alert tone="info" compact>En un sprint la duración es su <strong>timebox</strong>: dura al menos esto aunque sus tareas terminen antes.</Alert>
          )}
          {durationEditable && (
            <>
              <div className="segmented" role="radiogroup" aria-label="Tipo de estimación">
                {(['manual', 'pert'] as EstimationMode[]).map((m) => (
                  <button key={m} role="radio" aria-checked={s.mode === m} className={s.mode === m ? 'active' : ''} onClick={() => set('mode', m)}>
                    {ESTIMATION_LABEL[m]}
                  </button>
                ))}
              </div>
              <Field label="Unidad">
                <select value={s.unit} onChange={(e) => set('unit', e.target.value as TimeUnit)}>
                  {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
                </select>
              </Field>
              {s.mode === 'manual' ? (
                <Field label={`Duración (${UNIT_LABEL[s.unit]})`} required error={errors.durationValue}>
                  <input type="number" min={0} step={0.5} value={s.durationValue} onChange={(e) => set('durationValue', Number(e.target.value))} />
                </Field>
              ) : (
                <>
                  <div className="grid-3">
                    <Field label="Optimista (O)" required error={errors.optimistic}>
                      <input type="number" min={0} step={0.5} value={s.optimistic} onChange={(e) => set('optimistic', Number(e.target.value))} />
                    </Field>
                    <Field label="Más probable (M)" required error={errors.mostLikely}>
                      <input type="number" min={0} step={0.5} value={s.mostLikely} onChange={(e) => set('mostLikely', Number(e.target.value))} />
                    </Field>
                    <Field label="Pesimista (P)" required error={errors.pessimistic}>
                      <input type="number" min={0} step={0.5} value={s.pessimistic} onChange={(e) => set('pessimistic', Number(e.target.value))} />
                    </Field>
                  </div>
                  {errors.pert || !(s.optimistic <= s.mostLikely && s.mostLikely <= s.pessimistic) ? (
                    <Alert tone="error" compact title="Estimación PERT inválida">Debe cumplirse O ≤ M ≤ P (RN-17).</Alert>
                  ) : (
                    <div className="pert-box">
                      <div>TE = (O + 4M + P) / 6 = ({s.optimistic} + 4·{s.mostLikely} + {s.pessimistic}) / 6 = <strong>{round(te)} {UNIT_LABEL[s.unit]}</strong></div>
                      <div>σ = (P − O) / 6 = {round(sigma)} · varianza = {round(sigma * sigma)}</div>
                      <div className="muted small">TE se usará como duración planificada (RN-18).</div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      {tab === 'dates' && (
        <>
          <div className="grid-2">
            <Field label="Restricción de fecha">
              <select value={s.constraintType} onChange={(e) => set('constraintType', e.target.value as ConstraintType)}>
                {Object.entries(CONSTRAINT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Fecha de la restricción" required={s.constraintType !== 'asap'} error={errors.constraintDate}>
              <input type="date" disabled={s.constraintType === 'asap'} value={s.constraintDate}
                onChange={(e) => set('constraintDate', e.target.value)} />
            </Field>
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
        {dirty && <span className="dirty-badge">Cambios sin guardar</span>}
        <Button onClick={onCancel} disabled={update.isPending || move.isPending}>Cancelar</Button>
        <Button variant="primary" onClick={save} loading={update.isPending || move.isPending} loadingText="Guardando…">
          Guardar y recalcular
        </Button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ dependencies
interface DependencyChange {
  dependency: Dependency
  type: DependencyType
  lag: number
  unit: TimeUnit
}

function DependenciesTab({ project, item }: { project: Project; item: WorkItem }) {
  const dialogs = useDialogs()
  const byId = useMemo(() => new Map(project.items.map((i) => [i.id, i])), [project.items])
  const names = useMemo(() => new Map(project.items.map((i) => [i.id, i.name])), [project.items])
  const predecessors = project.dependencies.filter((d) => d.successor_id === item.id)
  const successors = project.dependencies.filter((d) => d.predecessor_id === item.id)
  const related = useMemo(() => {
    const ancestors = new Set<string>()
    let current = item.parent_id
    while (current) {
      ancestors.add(current)
      current = byId.get(current)?.parent_id ?? null
    }
    return new Set([...ancestors, ...descendantIds(project.items, item.id)])
  }, [project.items, item, byId])
  const candidates = project.items.filter((i) => !related.has(i.id) && !predecessors.some((d) => d.predecessor_id === i.id))

  const emptyDraft = { predecessorId: '', type: 'FS' as DependencyType, lag: 0, unit: 'day' as TimeUnit }
  const [draft, setDraft] = useState(emptyDraft)
  const [draftError, setDraftError] = useState<string>()
  const describe = (d: Dependency) => MSG.describeDependency(d, names)

  const create = useProjectMutation(project.id, () => api.createDependency(project.id,
    { predecessor_id: draft.predecessorId, successor_id: item.id, type: draft.type, lag_value: draft.lag, lag_unit: draft.unit }), {
    success: () => MSG.dependencyCreated(dependencyText(names.get(draft.predecessorId) ?? '?', item.name, draft.type, draft.lag, draft.unit)),
    error: 'No se pudo crear la dependencia',
  })
  const updateDep = useProjectMutation(project.id,
    (c: DependencyChange) => api.updateDependency(project.id, c.dependency.id, c.type, c.lag, c.unit), {
      success: (_, c) => MSG.dependencyUpdated(dependencyText(names.get(c.dependency.predecessor_id) ?? '?',
        names.get(c.dependency.successor_id) ?? '?', c.type, c.lag, c.unit)),
      error: 'No se pudo actualizar la dependencia',
    })
  const remove = useProjectMutation(project.id, (d: Dependency) => api.deleteDependency(project.id, d.id), {
    success: (_, d) => MSG.dependencyDeleted(describe(d)),
    error: 'No se pudo eliminar la dependencia',
  })

  const confirmRemove = async (d: Dependency) => {
    if (await dialogs.confirm({ ...MSG.confirmDeleteDependency(describe(d)), tone: 'danger' })) remove.mutate(d)
  }
  const add = () => {
    if (!draft.predecessorId) return setDraftError('Seleccione la actividad predecesora.')
    if (!Number.isFinite(draft.lag)) return setDraftError('El lag debe ser un número (negativo = adelanto).')
    setDraftError(undefined)
    create.mutate(undefined, { onSuccess: () => setDraft(emptyDraft) })
  }
  const changeLag = (d: Dependency, raw: string) => {
    const lag = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(lag) || lag === d.lag_value) return
    updateDep.mutate({ dependency: d, type: d.type, lag, unit: d.lag_unit })
  }
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
              <tr key={d.id} className={updateDep.isPending && updateDep.variables?.dependency.id === d.id ? 'is-saving' : ''}>
                <td>{label(d.predecessor_id)}</td>
                <td>
                  <select value={d.type} aria-label="Tipo de dependencia"
                    onChange={(e) => updateDep.mutate({ dependency: d, type: e.target.value as DependencyType, lag: d.lag_value, unit: d.lag_unit })}>
                    {DEP_TYPES.map((t) => <option key={t} value={t}>{DEPENDENCY_LABEL[t]}</option>)}
                  </select>
                </td>
                <td>
                  <div className="input-group">
                    <input type="number" step={0.5} defaultValue={d.lag_value} key={`${d.id}-${d.lag_value}`} aria-label="Lag"
                      onBlur={(e) => changeLag(d, e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                    <select value={d.lag_unit} aria-label="Unidad del lag"
                      onChange={(e) => updateDep.mutate({ dependency: d, type: d.type, lag: d.lag_value, unit: e.target.value as TimeUnit })}>
                      {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
                    </select>
                  </div>
                </td>
                <td>
                  <button className="icon-btn danger" title="Eliminar dependencia" aria-label="Eliminar dependencia"
                    disabled={remove.isPending} onClick={() => confirmRemove(d)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="add-dependency">
        <select value={draft.predecessorId} aria-label="Nueva predecesora" className={draftError && !draft.predecessorId ? 'invalid' : ''}
          onChange={(e) => { setDraft({ ...draft, predecessorId: e.target.value }); setDraftError(undefined) }}>
          <option value="">— Agregar predecesora —</option>
          {candidates.map((c) => <option key={c.id} value={c.id}>{label(c.id)}</option>)}
        </select>
        <select value={draft.type} aria-label="Tipo" onChange={(e) => setDraft({ ...draft, type: e.target.value as DependencyType })}>
          {DEP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="number" step={0.5} value={draft.lag} aria-label="Lag" title="Lag positivo = retraso; negativo = adelanto (lead)"
          onChange={(e) => setDraft({ ...draft, lag: Number(e.target.value) })} />
        <select value={draft.unit} aria-label="Unidad" onChange={(e) => setDraft({ ...draft, unit: e.target.value as TimeUnit })}>
          {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
        </select>
        <Button variant="primary" loading={create.isPending} onClick={add}>Agregar</Button>
      </div>
      <InlineError>{draftError}</InlineError>
      <p className="hint">Se rechazan autodependencias, duplicados y ciclos (A → B → C → A), incluidos los que se forman a través de la jerarquía.</p>

      <h3>Sucesoras</h3>
      {successors.length === 0 ? <p className="muted">Ninguna.</p> : (
        <ul className="plain-list">
          {successors.map((d) => (
            <li key={d.id}>
              {label(d.successor_id)} <span className="badge">{d.type}{formatLag(d.lag_value, d.lag_unit)}</span>
              <button className="icon-btn danger" onClick={() => confirmRemove(d)} disabled={remove.isPending}
                title="Eliminar dependencia" aria-label="Eliminar dependencia">✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// --------------------------------------------------------------------- resources
function ResourcesTab({ project, item, onDirtyChange, onCancel }: {
  project: Project
  item: WorkItem
  onDirtyChange: (dirty: boolean) => void
  onCancel: () => void
}) {
  const [initial] = useState(() => new Map(item.assignments.map((a) => [a.member_id, a.units])))
  const [selection, setSelection] = useState<Map<string, number>>(initial)
  const notify = useNotify()
  const memberNames = new Map(project.members.map((m) => [m.id, m.name]))
  const save = useProjectMutation(project.id, () =>
    api.setAssignments(project.id, item.id, [...selection].map(([member_id, units]) => ({ member_id, units }))), {
    success: () => MSG.assignmentsSaved(item, [...selection.keys()].map((id) => memberNames.get(id) ?? '?')),
    error: `No se pudieron guardar los responsables de “${item.name}”`,
  })
  const roles = new Map(project.roles.map((r) => [r.id, r.name]))
  const dirty = !sameValues([...selection].sort(), [...initial].sort())
  useLayoutEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  const unitErrors: Errors = Object.fromEntries([...selection].map(([id, units]) => [id, rules.range(units, 1, 100)]))
  const inactiveSelected = project.members.filter((m) => !m.active && selection.has(m.id))

  const toggle = (id: string) => {
    const next = new Map(selection)
    if (next.has(id)) next.delete(id)
    else next.set(id, 100)
    setSelection(next)
  }
  const submit = () => {
    if (hasErrors(unitErrors)) {
      notify.warning(MSG.fixFields(errorList(unitErrors, Object.fromEntries(memberNames))))
      return
    }
    if (!dirty) {
      notify.info(MSG.noChanges)
      return
    }
    save.mutate(undefined)
  }

  if (project.members.length === 0) {
    return <Alert tone="info" title="No hay integrantes">Registre integrantes en la pestaña “Equipo” para poder asignarlos.</Alert>
  }
  return (
    <div className="form">
      {item.is_summary && <Alert tone="info" compact>Es un elemento resumen: la carga de trabajo se calcula sobre sus hijos.</Alert>}
      {inactiveSelected.length > 0 && (
        <Alert tone="warning" compact>
          {inactiveSelected.map((m) => m.name).join(', ')} {inactiveSelected.length > 1 ? 'están inactivos' : 'está inactivo'}; la asignación se marcará como alerta.
        </Alert>
      )}
      <table className="table compact">
        <thead><tr><th /><th>Integrante</th><th>Rol</th><th>Disponibilidad</th><th>Dedicación</th></tr></thead>
        <tbody>
          {project.members.map((m) => (
            <tr key={m.id} className={m.active ? '' : 'inactive'}>
              <td><input type="checkbox" checked={selection.has(m.id)} onChange={() => toggle(m.id)} aria-label={`Asignar a ${m.name}`} /></td>
              <td>{m.name}{!m.active && ' (inactivo)'}</td>
              <td>{m.role_id ? roles.get(m.role_id) : '—'}</td>
              <td>{m.hours_per_day} h/día</td>
              <td>
                <input type="number" min={1} max={100} step={5} disabled={!selection.has(m.id)} value={selection.get(m.id) ?? 100}
                  className={unitErrors[m.id] ? 'invalid' : ''} aria-label={`Dedicación de ${m.name}`}
                  onChange={(e) => setSelection(new Map(selection).set(m.id, Number(e.target.value)))} /> %
                <InlineError>{unitErrors[m.id]}</InlineError>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-actions">
        {dirty && <span className="dirty-badge">Cambios sin guardar</span>}
        <Button onClick={onCancel} disabled={save.isPending}>Cancelar</Button>
        <Button variant="primary" loading={save.isPending} loadingText="Guardando…" onClick={submit}>Guardar responsables</Button>
      </div>
    </div>
  )
}
