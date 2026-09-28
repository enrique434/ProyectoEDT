// Time scale of the Gantt: maps dates to pixels.
// A working day occupies its whole column (08:00 -> left edge, 17:00 -> right edge), like ProjectLibre.
import type { Project, WorkItem } from '../../api/types'
import { parseLocal, toIsoDate } from '../../lib/format'

export type Zoom = 'day' | 'week' | 'month'
export const PX_PER_DAY: Record<Zoom, number> = { day: 34, week: 14, month: 4 }
export const ROW_HEIGHT = 30
const DAY_MS = 86_400_000

export interface GanttScale {
  start: Date
  days: number
  pxPerDay: number
  width: number
  x: (value: string | Date) => number
  dayAt: (index: number) => Date
  isWorkingDay: (day: Date) => boolean
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function workingWindow(project: Project): [number, number] {
  const intervals = Object.values(project.calendar.week).flat()
  if (intervals.length === 0) return [0, 1440]
  return [Math.min(...intervals.map((i) => minutesOf(i.start))), Math.max(...intervals.map((i) => minutesOf(i.end)))]
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function dayIndex(from: Date, to: Date): number {
  // Robust to DST: compare calendar dates at noon.
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / DAY_MS)
}

export function buildScale(project: Project, items: WorkItem[], zoom: Zoom): GanttScale {
  const starts = items.filter((i) => i.schedule).map((i) => parseLocal(i.schedule!.start))
  const finishes = items.filter((i) => i.schedule).map((i) => parseLocal(i.schedule!.finish))
  const projectStart = parseLocal(project.start_date)
  const first = new Date(Math.min(projectStart.getTime(), ...starts.map((d) => d.getTime())))
  const lastCandidates = [...finishes, projectStart]
  if (project.target_date) lastCandidates.push(parseLocal(project.target_date))
  const last = new Date(Math.max(...lastCandidates.map((d) => d.getTime())))

  const padBefore = zoom === 'month' ? 7 : 2
  const padAfter = zoom === 'day' ? 10 : zoom === 'week' ? 21 : 60
  let start = addDays(first, -padBefore)
  if (zoom !== 'day') start = addDays(start, -((start.getDay() + 6) % 7)) // align to Monday
  const days = dayIndex(start, last) + padAfter
  const pxPerDay = PX_PER_DAY[zoom]
  const [windowStart, windowEnd] = workingWindow(project)

  const exceptions = new Map(project.calendar.exceptions.map((e) => [e.day, e.is_working]))
  const isWorkingDay = (day: Date) => {
    const exception = exceptions.get(toIsoDate(day))
    if (exception !== undefined) return exception
    return (project.calendar.week[String((day.getDay() + 6) % 7)] ?? []).length > 0
  }

  const x = (value: string | Date) => {
    const date = typeof value === 'string' ? parseLocal(value) : value
    const minutes = date.getHours() * 60 + date.getMinutes()
    const fraction = Math.min(1, Math.max(0, (minutes - windowStart) / (windowEnd - windowStart)))
    return (dayIndex(start, date) + fraction) * pxPerDay
  }

  return { start, days, pxPerDay, width: days * pxPerDay, x, dayAt: (i) => addDays(start, i), isWorkingDay }
}

export interface HeaderCell {
  x: number
  width: number
  label: string
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const WEEKDAY_LETTER = ['D', 'L', 'M', 'X', 'J', 'V', 'S']

/** Two header rows: [top, bottom]. */
export function headerCells(scale: GanttScale, zoom: Zoom): [HeaderCell[], HeaderCell[]] {
  const top: HeaderCell[] = []
  const bottom: HeaderCell[] = []
  const px = scale.pxPerDay
  let topKey = ''
  for (let i = 0; i < scale.days; i++) {
    const day = scale.dayAt(i)
    const key = zoom === 'month' ? String(day.getFullYear()) : `${day.getFullYear()}-${day.getMonth()}`
    if (key !== topKey) {
      topKey = key
      top.push({ x: i * px, width: 0, label: zoom === 'month' ? key : `${MONTHS[day.getMonth()]} ${day.getFullYear()}` })
    }
    top[top.length - 1].width += px

    if (zoom === 'day') {
      bottom.push({ x: i * px, width: px, label: `${WEEKDAY_LETTER[day.getDay()]} ${day.getDate()}` })
    } else if (zoom === 'week' && day.getDay() === 1) {
      bottom.push({ x: i * px, width: 7 * px, label: `${day.getDate()}/${day.getMonth() + 1}` })
    } else if (zoom === 'month' && day.getDate() === 1) {
      const length = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate()
      bottom.push({ x: i * px, width: length * px, label: MONTHS[day.getMonth()] })
    }
  }
  return [top, bottom]
}
