import {
  useCallback, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type UIEvent,
} from 'react'
import { api } from '../../api/client'
import { useProjectMutation } from '../../api/hooks'
import type { Project, WorkItem, WorkItemKind } from '../../api/types'
import { Button } from '../../components/Button'
import { useNotify } from '../../components/feedback/Notifications'
import { KIND_LABEL, KIND_ORDER } from '../../lib/labels'
import { MSG, dependencyText, theKind } from '../../lib/messages'
import { formatDate, formatDays, formatDuration, predecessorNotation } from '../../lib/format'
import { insertionTarget, memberNames, visibleItems } from '../../lib/wbs'
import { GanttBody, GanttHeader } from '../gantt/GanttChart'
import { ROW_HEIGHT, buildScale, type Zoom } from '../gantt/scale'
import { ItemEditor } from './ItemEditor'
import { useDeleteItem } from './useDeleteItem'

const KIND_ICON: Record<WorkItemKind, string> = {
  phase: '▣', sprint: '⟳', story: '◉', task: '▪', subtask: '·', milestone: '◆',
}

export function PlanView({ project }: { project: Project }) {
  const notify = useNotify()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
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

  const create = useProjectMutation(project.id,
    (a: { kind: WorkItemKind; parentId: string | null; name: string }) =>
      api.createItem(project.id, { kind: a.kind, name: a.name, parent_id: a.parentId }), {
      success: (updated, a, createdId) => {
        const item = updated.items.find((i) => i.id === createdId)
        return item ? MSG.itemCreated(item, updated.items.find((i) => i.id === a.parentId)) : null
      },
      error: (a) => `No se pudo crear ${theKind(a.kind)}`,
    })
  const move = useProjectMutation(project.id,
    (a: { item: WorkItem; position: number }) => api.moveItem(project.id, a.item.id, a.item.parent_id, a.position), {
      error: (a) => `No se pudo mover “${a.item.name}”`, // the new position in the outline is the feedback
    })
  const link = useProjectMutation(project.id,
    (a: { from: WorkItem; to: WorkItem }) => api.createDependency(project.id,
      { predecessor_id: a.from.id, successor_id: a.to.id, type: 'FS', lag_value: 0, lag_unit: 'day' }), {
      error: (a) => `No se pudo vincular “${a.from.name}” → “${a.to.name}”`,
    })
  const unlink = useProjectMutation(project.id, (id: string) => api.deleteDependency(project.id, id), {
    success: () => ({ title: 'Dependencia deshecha', message: 'Se eliminó la dependencia recién creada.' }),
    error: 'No se pudo deshacer la dependencia',
  })
  const recalc = useProjectMutation(project.id, () => api.recalculate(project.id), {
    success: (updated) => MSG.recalculated(updated.schedule?.finish),
    error: 'No se pudo recalcular el cronograma',
  })
  const { requestDelete, isDeleting } = useDeleteItem(project, () => setSelectedId(null))

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

  const linkItems = (fromId: string, toId: string) => {
    const from = byId.get(fromId)
    const to = byId.get(toId)
    if (!from || !to) return
    link.mutate({ from, to }, {
      onSuccess: (result) => notify.success({
        ...MSG.dependencyCreated(dependencyText(from.name, to.name, 'FS', 0, 'day')),
        action: 'id' in result ? { label: 'Deshacer', onClick: () => unlink.mutate(result.id) } : undefined,
      }),
    })
  }

  const siblings = selected ? project.items.filter((i) => i.parent_id === selected.parent_id) : []
  const selectedIndex = selected ? siblings.findIndex((i) => i.id === selected.id) : -1
  const shift = (delta: number) => {
    const position = selectedIndex + delta
    if (!selected || position < 0 || position >= siblings.length) return
    move.mutate({ item: selected, position })
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!selected || (e.target as HTMLElement).closest('input, select, textarea, .modal')) return
    if (e.key === 'Delete') requestDelete(selected)
    else if (e.key === 'Enter') setEditingId(selected.id)
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

  return (
    <div className="plan" onKeyDown={onKeyDown} tabIndex={-1}>
      <div className="toolbar">
        <div className="toolbar-group">
          {KIND_ORDER.map((kind) => {
            const target = insertionTarget(project, selected, kind)
            return (
              <Button key={kind} size="sm" disabled={!target} loading={create.isPending && create.variables?.kind === kind}
                onClick={() => add(kind)}
                title={target ? `Agregar ${KIND_LABEL[kind].toLowerCase()}` : `La metodología no permite agregar ${theKind(kind)} aquí`}>
                + {KIND_LABEL[kind]}
              </Button>
            )
          })}
        </div>
        <div className="toolbar-group">
          <Button size="sm" disabled={!selected} onClick={() => selected && setEditingId(selected.id)}
            title={selected ? 'Editar (Enter)' : 'Seleccione una fila'}>✎ Editar</Button>
          <Button size="sm" disabled={selectedIndex <= 0 || move.isPending} onClick={() => shift(-1)}
            title={selected ? 'Subir dentro de su contenedor' : 'Seleccione una fila'} aria-label="Subir">▲</Button>
          <Button size="sm" disabled={!selected || selectedIndex >= siblings.length - 1 || move.isPending} onClick={() => shift(1)}
            title={selected ? 'Bajar dentro de su contenedor' : 'Seleccione una fila'} aria-label="Bajar">▼</Button>
          <Button size="sm" className="btn-danger-outline" disabled={!selected} loading={isDeleting}
            onClick={() => selected && requestDelete(selected)} title={selected ? 'Eliminar (Supr)' : 'Seleccione una fila'}>
            🗑 Eliminar
          </Button>
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
          <Button size="sm" loading={recalc.isPending} onClick={() => recalc.mutate(undefined)}>↻ Recalcular</Button>
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
                onLink={linkItems} />
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
        <span className="muted">Doble clic o Enter para editar · Supr para eliminar · arrastre una barra sobre otra para vincular (FS)</span>
      </div>

      {editing && <ItemEditor project={project} item={editing} onClose={() => setEditingId(null)} />}
    </div>
  )
}
