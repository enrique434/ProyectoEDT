import { useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type UIEvent } from 'react'
import { api } from '../../api/client'
import { useProjectMutation } from '../../api/hooks'
import type { Project, WorkItem, WorkItemKind } from '../../api/types'
import { useToast } from '../../components/Toast'
import { KIND_LABEL, KIND_ORDER } from '../../lib/labels'
import { formatDate, formatDays, formatDuration, predecessorNotation } from '../../lib/format'
import { insertionTarget, memberNames, visibleItems } from '../../lib/wbs'
import { GanttBody, GanttHeader } from '../gantt/GanttChart'
import { ROW_HEIGHT, buildScale, type Zoom } from '../gantt/scale'
import { DeleteItemDialog } from './DeleteItemDialog'
import { ItemEditor } from './ItemEditor'

const KIND_ICON: Record<WorkItemKind, string> = {
  phase: '▣', sprint: '⟳', story: '◉', task: '▪', subtask: '·', milestone: '◆',
}

export function PlanView({ project }: { project: Project }) {
  const toast = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [zoom, setZoom] = useState<Zoom>('day')
  const [criticalOnly, setCriticalOnly] = useState(false)
  const [gridWidth, setGridWidth] = useState(760)

  const gridBodyRef = useRef<HTMLDivElement>(null)
  const ganttBodyRef = useRef<HTMLDivElement>(null)
  const ganttHeaderRef = useRef<HTMLDivElement>(null)

  const byId = useMemo(() => new Map(project.items.map((i) => [i.id, i])), [project.items])
  const rowsById = useMemo(() => new Map(project.items.map((i) => [i.id, i.row])), [project.items])
  const selected = selectedId ? byId.get(selectedId) ?? null : null

  const rows = useMemo(() => {
    if (!criticalOnly) return visibleItems(project.items, collapsed)
    const keep = new Set<string>()
    for (const item of project.items) {
      if (item.schedule?.is_critical) {
        let current: string | null = item.id
        while (current) {
          keep.add(current)
          current = byId.get(current)?.parent_id ?? null
        }
      }
    }
    return project.items.filter((i) => keep.has(i.id))
  }, [project.items, collapsed, criticalOnly, byId])
  const scale = useMemo(() => buildScale(project, project.items, zoom), [project, zoom])

  const create = useProjectMutation(project.id, (a: { kind: WorkItemKind; parentId: string | null; name: string }) =>
    api.createItem(project.id, { kind: a.kind, name: a.name, parent_id: a.parentId }))
  const move = useProjectMutation(project.id, (a: { id: string; parentId: string | null; position: number }) =>
    api.moveItem(project.id, a.id, a.parentId, a.position))
  const link = useProjectMutation(project.id, (a: { from: string; to: string }) =>
    api.createDependency(project.id, { predecessor_id: a.from, successor_id: a.to, type: 'FS', lag_value: 0, lag_unit: 'day' }))
  const recalc = useProjectMutation(project.id, () => api.recalculate(project.id))

  const add = (kind: WorkItemKind) => {
    const target = insertionTarget(project, selected, kind)
    if (!target) return
    const count = project.items.filter((i) => i.kind === kind).length + 1
    const name = kind === 'sprint' ? `Sprint ${count}` : `${KIND_LABEL[kind]} ${count}`
    create.mutate({ kind, parentId: target.parentId, name }, {
      onSuccess: (result) => {
        if (target.parentId) setCollapsed((c) => { const n = new Set(c); n.delete(target.parentId!); return n })
        if ('id' in result) {
          setSelectedId(result.id)
          setEditingId(result.id)
        }
      },
    })
  }

  const shift = (delta: number) => {
    if (!selected) return
    const siblings = project.items.filter((i) => i.parent_id === selected.parent_id)
    const index = siblings.findIndex((i) => i.id === selected.id)
    const position = index + delta
    if (position < 0 || position >= siblings.length) return
    move.mutate({ id: selected.id, parentId: selected.parent_id, position })
  }

  const toggle = (id: string) =>
    setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const onGanttScroll = (e: UIEvent<HTMLDivElement>) => {
    if (gridBodyRef.current) gridBodyRef.current.scrollTop = e.currentTarget.scrollTop
    if (ganttHeaderRef.current) ganttHeaderRef.current.scrollLeft = e.currentTarget.scrollLeft
  }
  const onGridScroll = (e: UIEvent<HTMLDivElement>) => {
    if (ganttBodyRef.current && ganttBodyRef.current.scrollTop !== e.currentTarget.scrollTop) {
      ganttBodyRef.current.scrollTop = e.currentTarget.scrollTop
    }
  }
  const scrollToItem = useCallback((item: WorkItem) => {
    if (item.schedule && ganttBodyRef.current) {
      ganttBodyRef.current.scrollLeft = Math.max(0, scale.x(item.schedule.start) - 80)
    }
  }, [scale])

  const startResize = (e: ReactMouseEvent) => {
    const startX = e.clientX
    const startWidth = gridWidth
    const onMove = (ev: MouseEvent) => setGridWidth(Math.min(1400, Math.max(280, startWidth + ev.clientX - startX)))
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const mpd = project.settings.minutes_per_day
  const editing = editingId ? byId.get(editingId) : undefined
  const deleting = deletingId ? byId.get(deletingId) : undefined

  return (
    <div className="plan">
      <div className="toolbar">
        <div className="toolbar-group">
          {KIND_ORDER.map((kind) => {
            const target = insertionTarget(project, selected, kind)
            return (
              <button key={kind} className="btn btn-sm" disabled={!target || create.isPending} onClick={() => add(kind)}
                title={target ? `Agregar ${KIND_LABEL[kind].toLowerCase()}` : `La metodología no permite una ${KIND_LABEL[kind].toLowerCase()} aquí`}>
                + {KIND_LABEL[kind]}
              </button>
            )
          })}
        </div>
        <div className="toolbar-group">
          <button className="btn btn-sm" disabled={!selected} onClick={() => selected && setEditingId(selected.id)}>✎ Editar</button>
          <button className="btn btn-sm" disabled={!selected} onClick={() => shift(-1)} title="Subir">▲</button>
          <button className="btn btn-sm" disabled={!selected} onClick={() => shift(1)} title="Bajar">▼</button>
          <button className="btn btn-sm btn-danger-outline" disabled={!selected} onClick={() => selected && setDeletingId(selected.id)}>🗑 Eliminar</button>
        </div>
        <div className="toolbar-group">
          <button className="btn btn-sm" onClick={() => setCollapsed(new Set())}>Expandir</button>
          <button className="btn btn-sm" onClick={() => setCollapsed(new Set(project.items.filter((i) => i.is_summary).map((i) => i.id)))}>Contraer</button>
          <label className="check">
            <input type="checkbox" checked={criticalOnly} onChange={(e) => setCriticalOnly(e.target.checked)} /> Solo ruta crítica
          </label>
        </div>
        <div className="toolbar-group">
          <div className="segmented">
            {(['day', 'week', 'month'] as Zoom[]).map((z) => (
              <button key={z} className={zoom === z ? 'active' : ''} onClick={() => setZoom(z)}>
                {z === 'day' ? 'Días' : z === 'week' ? 'Semanas' : 'Meses'}
              </button>
            ))}
          </div>
          <button className="btn btn-sm" disabled={recalc.isPending}
            onClick={() => recalc.mutate(undefined, { onSuccess: () => toast.success('Cronograma recalculado (CPM)') })}>
            ↻ Recalcular
          </button>
        </div>
      </div>

      {project.items.length === 0 ? (
        <div className="empty">
          <h2>La EDT está vacía</h2>
          <p>Use los botones “+ Fase”, “+ Sprint”, “+ Tarea”… para construir la estructura. La metodología determina qué se puede crear dentro de qué.</p>
        </div>
      ) : (
        <div className="plan-body">
          <div className="grid-pane" style={{ width: gridWidth }}>
            <div className="grid-header">
              <div className="c-row">#</div>
              <div className="c-wbs">EDT</div>
              <div className="c-name">Nombre</div>
              <div className="c-dur">Duración</div>
              <div className="c-date">Inicio</div>
              <div className="c-date">Fin</div>
              <div className="c-pred">Predecesoras</div>
              <div className="c-float">Holgura</div>
              <div className="c-pct">%</div>
              <div className="c-res">Recursos</div>
            </div>
            <div className="grid-body" ref={gridBodyRef} onScroll={onGridScroll}>
              {rows.map((item) => (
                <div key={item.id} style={{ height: ROW_HEIGHT }}
                  className={`grid-row kind-${item.kind} ${item.is_summary ? 'summary' : ''} ${item.id === selectedId ? 'selected' : ''} ${item.schedule?.is_critical ? 'critical' : ''}`}
                  onClick={() => { setSelectedId(item.id); scrollToItem(item) }}
                  onDoubleClick={() => setEditingId(item.id)}>
                  <div className="c-row">{item.row}</div>
                  <div className="c-wbs">{item.wbs_code}</div>
                  <div className="c-name" style={{ paddingLeft: 6 + item.level * 16 }} title={item.name}>
                    {item.is_summary ? (
                      <button className="tree-toggle" onClick={(e) => { e.stopPropagation(); toggle(item.id) }}>
                        {collapsed.has(item.id) ? '▸' : '▾'}
                      </button>
                    ) : <span className="tree-toggle" />}
                    <span className={`kind-icon kind-${item.kind}`} title={KIND_LABEL[item.kind]}>{KIND_ICON[item.kind]}</span>
                    <span className="name-text">{item.name}</span>
                    {item.estimation_mode === 'pert' && <span className="tag" title="Duración estimada con PERT">PERT</span>}
                  </div>
                  <div className="c-dur">
                    {item.is_summary && item.kind !== 'sprint' && item.schedule
                      ? formatDays(item.schedule.early_finish - item.schedule.early_start, mpd)
                      : formatDuration(item)}
                  </div>
                  <div className="c-date">{formatDate(item.schedule?.start)}</div>
                  <div className="c-date">{formatDate(item.schedule?.finish)}</div>
                  <div className="c-pred">{predecessorNotation(item, project.dependencies, rowsById)}</div>
                  <div className="c-float">{item.schedule ? formatDays(item.schedule.total_float, mpd) : '—'}</div>
                  <div className="c-pct">{item.progress}%</div>
                  <div className="c-res" title={memberNames(project, item)}>{memberNames(project, item)}</div>
                </div>
              ))}
              <div style={{ height: 40 }} />
            </div>
          </div>
          <div className="splitter" onMouseDown={startResize} title="Arrastre para redimensionar" />
          <div className="gantt-pane">
            <div className="gantt-header" ref={ganttHeaderRef}>
              <GanttHeader scale={scale} zoom={zoom} />
            </div>
            <div className="gantt-body" ref={ganttBodyRef} onScroll={onGanttScroll}>
              <GanttBody project={project} rows={rows} scale={scale} selectedId={selectedId}
                onSelect={setSelectedId} onOpen={setEditingId}
                onLink={(from, to) => link.mutate({ from, to }, {
                  onSuccess: () => toast.success(`Dependencia FS: ${byId.get(from)?.name} → ${byId.get(to)?.name}`),
                })} />
              <div style={{ height: 40 }} />
            </div>
          </div>
        </div>
      )}

      <div className="legend">
        <span><i className="lg lg-task" /> Tarea</span>
        <span><i className="lg lg-critical" /> Crítica (holgura 0)</span>
        <span><i className="lg lg-phase" /> Fase</span>
        <span><i className="lg lg-sprint" /> Sprint</span>
        <span>◆ Hito</span>
        <span><i className="lg lg-nonworking" /> No laborable</span>
        <span className="muted">Doble clic para editar · arrastre una barra sobre otra para vincular (FS)</span>
      </div>

      {editing && <ItemEditor project={project} item={editing} onClose={() => setEditingId(null)} />}
      {deleting && <DeleteItemDialog project={project} item={deleting}
        onClose={() => { setDeletingId(null); setSelectedId(null) }} />}
    </div>
  )
}
