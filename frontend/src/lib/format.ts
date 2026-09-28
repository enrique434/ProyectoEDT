import type { Dependency, TimeUnit, WorkItem } from '../api/types'
import { UNIT_SHORT } from './labels'

/** Backend datetimes are naive local times ("2026-09-07T08:00:00"); parse them as local. */
export function parseLocal(value: string): Date {
  const [datePart, timePart = '00:00:00'] = value.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = timePart.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm)
}

export function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const dateFormatter = new Intl.DateTimeFormat('es', { day: '2-digit', month: '2-digit', year: '2-digit' })
const dateTimeFormatter = new Intl.DateTimeFormat('es', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
})
const longDateFormatter = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

export const formatDate = (value: string | null | undefined) => (value ? dateFormatter.format(parseLocal(value)) : '—')
export const formatDateTime = (value: string | null | undefined) =>
  value ? dateTimeFormatter.format(parseLocal(value)) : '—'
export const formatLongDate = (value: string | null | undefined) =>
  value ? longDateFormatter.format(parseLocal(value)) : '—'

export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** Working minutes -> "2.5 d" using the project's minutes per day. */
export function minutesToDays(minutes: number, minutesPerDay: number): number {
  return round(minutes / minutesPerDay)
}

export function formatDays(minutes: number, minutesPerDay: number): string {
  return `${minutesToDays(minutes, minutesPerDay)} d`
}

export function formatDuration(item: Pick<WorkItem, 'duration_value' | 'duration_unit'>): string {
  return `${round(item.duration_value)} ${UNIT_SHORT[item.duration_unit]}`
}

export function formatLag(value: number, unit: TimeUnit): string {
  if (value === 0) return ''
  return `${value > 0 ? '+' : ''}${round(value)}${UNIT_SHORT[unit]}`
}

/** ProjectLibre-style predecessor notation: "3FS+2d; 5SS". */
export function predecessorNotation(item: WorkItem, dependencies: Dependency[], rows: Map<string, number>): string {
  return dependencies
    .filter((d) => d.successor_id === item.id)
    .map((d) => `${rows.get(d.predecessor_id)}${d.type === 'FS' && d.lag_value === 0 ? '' : d.type}${formatLag(d.lag_value, d.lag_unit)}`)
    .join('; ')
}

export function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${round(value * 100, 1)} %`
}
