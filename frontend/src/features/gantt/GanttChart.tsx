import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { Dependency, Project, WorkItem } from '../../api/types'
import { formatDateTime, formatDays, formatDuration, toIsoDate } from '../../lib/format'
import { KIND_LABEL } from '../../lib/labels'
import { memberNames } from '../../lib/wbs'
import { ROW_HEIGHT, headerCells, type GanttScale, type Zoom } from './scale'

const BAR_HEIGHT = 14
const SUMMARY_HEIGHT = 7

export function GanttHeader({ scale, zoom }: { scale: GanttScale; zoom: Zoom }) {
  const [top, bottom] = useMemo(() => headerCells(scale, zoom), [scale, zoom])
  return (
    <svg width={scale.width} height={48} className="gantt-header-svg">
      {top.map((c) => (
        <g key={`t${c.x}`}>
          <rect x={c.x} y={0} width={c.width} height={24} className="gh-cell" />
          <text x={c.x + 6} y={16} className="gh-text">{c.label}</text>
        </g>
      ))}
      {bottom.map((c) => (
        <g key={`b${c.x}`}>
          <rect x={c.x} y={24} width={c.width} height={24} className="gh-cell" />
          <text x={c.x + c.width / 2} y={40} className="gh-text small" textAnchor="middle">{c.label}</text>
        </g>
      ))}
    </svg>
  )
}

interface GanttBodyProps {
  project: Project
  rows: WorkItem[]
  scale: GanttScale
  selectedId: string | null
  onSelect: (id: string) => void
  onOpen: (id: string) => void
  onLink: (predecessorId: string, successorId: string) => void
}

interface DragState {
  fromId: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export function GanttBody({ project, rows, scale, selectedId, onSelect, onOpen, onLink }: GanttBodyProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const height = Math.max(rows.length * ROW_HEIGHT, 200)
  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows])
  const minutesPerDay = project.settings.minutes_per_day

  const point = (e: ReactMouseEvent) => {
    const box = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }
  const startDrag = (e: ReactMouseEvent, item: WorkItem) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const p = point(e)
    setDrag({ fromId: item.id, x1: p.x, y1: p.y, x2: p.x, y2: p.y })
  }
  const endDragOn = (item: WorkItem) => {
    if (drag && drag.fromId !== item.id && Math.hypot(drag.x2 - drag.x1, drag.y2 - drag.y1) > 6) {
      onLink(drag.fromId, item.id)
    }
  }

  const today = new Date()
  const todayX = scale.x(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0))
  const nonWorking = useMemo(() => {
    if (scale.pxPerDay < 4) return []
    const result: number[] = []
    for (let i = 0; i < scale.days; i++) if (!scale.isWorkingDay(scale.dayAt(i))) result.push(i)
    return result
  }, [scale])

  return (
    <svg ref={svgRef} width={scale.width} height={height} className="gantt-body-svg"
      onMouseMove={(e) => drag && setDrag({ ...drag, ...(({ x, y }) => ({ x2: x, y2: y }))(point(e)) })}
      onMouseUp={() => setDrag(null)} onMouseLeave={() => setDrag(null)}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arrow-head" />
        </marker>
        <marker id="arrow-critical" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arrow-head critical" />
        </marker>
      </defs>

      {nonWorking.map((i) => (
        <rect key={i} x={i * scale.pxPerDay} y={0} width={scale.pxPerDay} height={height} className="non-working" />
      ))}
      {rows.map((item, i) => (
        <rect key={item.id} x={0} y={i * ROW_HEIGHT} width={scale.width} height={ROW_HEIGHT}
          className={`gantt-row ${item.id === selectedId ? 'selected' : ''}`} onClick={() => onSelect(item.id)} />
      ))}
      {project.target_date && (
        <line x1={scale.x(`${project.target_date}T23:59`)} x2={scale.x(`${project.target_date}T23:59`)} y1={0} y2={height}
          className="target-line"><title>Fecha objetivo</title></line>
      )}
      {todayX >= 0 && todayX <= scale.width && (
        <line x1={todayX} x2={todayX} y1={0} y2={height} className="today-line"><title>Hoy {toIsoDate(today)}</title></line>
      )}

      {project.dependencies.map((d) => (
        <DependencyArrow key={d.id} dependency={d} project={project} rowIndex={rowIndex} scale={scale} />
      ))}

      {rows.map((item, i) => item.schedule && (
        <g key={item.id} className="bar-group" onMouseDown={(e) => startDrag(e, item)} onMouseUp={() => endDragOn(item)}
          onClick={() => onSelect(item.id)} onDoubleClick={() => onOpen(item.id)}>
          <title>
            {`${item.wbs_code} ${item.name} (${KIND_LABEL[item.kind]})\n`}
            {`Inicio: ${formatDateTime(item.schedule.start)}\nFin: ${formatDateTime(item.schedule.finish)}\n`}
            {`Duración: ${formatDuration(item)} · Holgura total: ${formatDays(item.schedule.total_float, minutesPerDay)}\n`}
            {`Avance: ${item.progress}%${item.schedule.is_critical ? ' · CRÍTICA' : ''}\n`}
            {'Arrastre hasta otra barra para crear una dependencia FS'}
          </title>
          <Bar item={item} y={i * ROW_HEIGHT} scale={scale} selected={item.id === selectedId} />
          <text x={scale.x(item.schedule.finish) + (item.kind === 'milestone' ? 12 : 6)} y={i * ROW_HEIGHT + ROW_HEIGHT / 2 + 4}
            className="bar-label">
            {item.kind === 'milestone' ? `${item.name} · ${formatDateTime(item.schedule.finish).slice(0, 10)}` : memberNames(project, item)}
          </text>
        </g>
      ))}

      {drag && <line x1={drag.x1} y1={drag.y1} x2={drag.x2} y2={drag.y2} className="drag-line" />}
    </svg>
  )
}

function Bar({ item, y, scale, selected }: { item: WorkItem; y: number; scale: GanttScale; selected: boolean }) {
  const s = item.schedule!
  const x1 = scale.x(s.start)
  const x2 = scale.x(s.finish)
  const mid = y + ROW_HEIGHT / 2
  const critical = s.is_critical ? 'critical' : ''

  if (item.kind === 'milestone' || (!item.is_summary && x2 - x1 < 1)) {
    const r = 7
    return <path d={`M${x2},${mid - r} L${x2 + r},${mid} L${x2},${mid + r} L${x2 - r},${mid} z`}
      className={`milestone ${critical} ${selected ? 'selected' : ''}`} />
  }
  if (item.is_summary) {
    const top = mid - SUMMARY_HEIGHT / 2
    const tip = 6
    return (
      <g className={`summary summary-${item.kind} ${critical} ${selected ? 'selected' : ''}`}>
        <rect x={x1} y={top} width={Math.max(2, x2 - x1)} height={SUMMARY_HEIGHT} />
        <path d={`M${x1},${top} l0,${SUMMARY_HEIGHT + tip} l${tip},-${tip} z`} />
        <path d={`M${x2},${top} l0,${SUMMARY_HEIGHT + tip} l-${tip},-${tip} z`} />
        {item.progress > 0 && (
          <rect x={x1} y={top + 2} width={(x2 - x1) * item.progress / 100} height={SUMMARY_HEIGHT - 4} className="summary-progress" />
        )}
      </g>
    )
  }
  const top = mid - BAR_HEIGHT / 2
  const width = Math.max(3, x2 - x1)
  return (
    <g className={`task-bar ${critical} ${selected ? 'selected' : ''} ${item.status === 'cancelled' ? 'cancelled' : ''}`}>
      <rect x={x1} y={top} width={width} height={BAR_HEIGHT} rx={2} className="bar" />
      {item.progress > 0 && (
        <rect x={x1} y={top + BAR_HEIGHT / 2 - 2} width={width * item.progress / 100} height={4} className="bar-progress" />
      )}
    </g>
  )
}

function DependencyArrow({ dependency, project, rowIndex, scale }: {
  dependency: Dependency
  project: Project
  rowIndex: Map<string, number>
  scale: GanttScale
}) {
  const fromRow = rowIndex.get(dependency.predecessor_id)
  const toRow = rowIndex.get(dependency.successor_id)
  if (fromRow === undefined || toRow === undefined) return null
  const byId = (id: string) => project.items.find((i) => i.id === id)!
  const pred = byId(dependency.predecessor_id)
  const succ = byId(dependency.successor_id)
  if (!pred.schedule || !succ.schedule) return null

  const fromStart = dependency.type === 'SS' || dependency.type === 'SF'
  const toFinish = dependency.type === 'FF' || dependency.type === 'SF'
  const x1 = scale.x(fromStart ? pred.schedule.start : pred.schedule.finish)
  const x2 = scale.x(toFinish ? succ.schedule.finish : succ.schedule.start)
  const y1 = fromRow * ROW_HEIGHT + ROW_HEIGHT / 2
  const y2 = toRow * ROW_HEIGHT + ROW_HEIGHT / 2
  const out = fromStart ? -8 : 8
  const inn = toFinish ? 8 : -8
  const xa = x1 + out
  const xb = x2 + inn
  const goesBackward = !toFinish && xa > xb
  const yMid = y2 + (y2 > y1 ? -ROW_HEIGHT / 2 : ROW_HEIGHT / 2)
  const d = goesBackward
    ? `M${x1},${y1} H${xa} V${yMid} H${xb} V${y2} H${x2}`
    : `M${x1},${y1} H${xa} V${y2} H${x2}`
  const critical = pred.schedule.is_critical && succ.schedule.is_critical
  return (
    <path d={d} className={`dep-arrow ${critical ? 'critical' : ''}`}
      markerEnd={`url(#${critical ? 'arrow-critical' : 'arrow'})`}>
      <title>{`${pred.name} → ${succ.name} (${dependency.type}${dependency.lag_value ? ` ${dependency.lag_value > 0 ? '+' : ''}${dependency.lag_value}` : ''})`}</title>
    </path>
  )
}
