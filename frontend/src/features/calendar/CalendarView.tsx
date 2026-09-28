import { useState } from 'react'
import { api } from '../../api/client'
import { useProjectMutation } from '../../api/hooks'
import type { CalendarInput, Interval, Project } from '../../api/types'
import { useToast } from '../../components/Toast'
import { WEEKDAY_LABEL } from '../../lib/labels'
import { formatLongDate } from '../../lib/format'

interface ExceptionDraft {
  day: string
  name: string
  working: boolean
  intervals: Interval[]
}

const minutes = (iv: Interval) => {
  const [sh, sm] = iv.start.split(':').map(Number)
  const [eh, em] = iv.end.split(':').map(Number)
  return eh * 60 + em - (sh * 60 + sm)
}
const hoursOf = (intervals: Interval[]) => intervals.reduce((acc, iv) => acc + Math.max(0, minutes(iv)), 0) / 60
const DEFAULT_DAY: Interval[] = [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }]

/** CU-04: weekly working pattern, holidays and exceptions of this project only (RN-02). */
export function CalendarView({ project }: { project: Project }) {
  const toast = useToast()
  const [week, setWeek] = useState<Interval[][]>(() =>
    Array.from({ length: 7 }, (_, d) => project.calendar.week[String(d)]?.map((iv) => ({ ...iv })) ?? []))
  const [exceptions, setExceptions] = useState<ExceptionDraft[]>(() =>
    project.calendar.exceptions.map((e) => ({ day: e.day, name: e.name, working: e.is_working, intervals: e.intervals })))
  const save = useProjectMutation(project.id, (input: CalendarInput) => api.updateCalendar(project.id, input))

  const setDay = (day: number, intervals: Interval[]) => setWeek((w) => w.map((v, i) => (i === day ? intervals : v)))
  const setInterval = (day: number, index: number, patch: Partial<Interval>) =>
    setDay(day, week[day].map((iv, i) => (i === index ? { ...iv, ...patch } : iv)))
  const setException = (index: number, patch: Partial<ExceptionDraft>) =>
    setExceptions((list) => list.map((e, i) => (i === index ? { ...e, ...patch } : e)))

  const submit = () => {
    if (exceptions.some((e) => !e.day)) {
      toast.error('Todas las excepciones necesitan una fecha')
      return
    }
    save.mutate({
      week: week.map((intervals, weekday) => ({ weekday, intervals })),
      exceptions: exceptions.map((e) => ({ day: e.day, name: e.name || 'Excepción', intervals: e.working ? e.intervals : [] })),
    }, { onSuccess: () => toast.success('Calendario guardado; fechas recalculadas') })
  }

  const weeklyHours = week.reduce((acc, day) => acc + hoursOf(day), 0)

  return (
    <div className="page-section">
      <div className="section-header">
        <div>
          <h2>Calendario laboral</h2>
          <p className="muted">
            Determina cuándo se puede trabajar. Los días no laborables y los feriados no consumen duración (RN-16).
            Total semanal: <strong>{weeklyHours} h</strong>
          </p>
        </div>
        <button className="btn btn-primary" onClick={submit} disabled={save.isPending}>
          {save.isPending ? 'Guardando…' : 'Guardar calendario'}
        </button>
      </div>

      <table className="table calendar-table">
        <thead><tr><th>Día</th><th>Laborable</th><th>Jornada (intervalos)</th><th className="num">Horas</th></tr></thead>
        <tbody>
          {week.map((intervals, day) => (
            <tr key={day} className={intervals.length ? '' : 'inactive'}>
              <td><strong>{WEEKDAY_LABEL[day]}</strong></td>
              <td>
                <input type="checkbox" checked={intervals.length > 0}
                  onChange={(e) => setDay(day, e.target.checked ? DEFAULT_DAY.map((iv) => ({ ...iv })) : [])} />
              </td>
              <td>
                <IntervalsEditor intervals={intervals}
                  onChange={(index, patch) => setInterval(day, index, patch)}
                  onAdd={() => setDay(day, [...intervals, { start: '14:00', end: '18:00' }])}
                  onRemove={(index) => setDay(day, intervals.filter((_, i) => i !== index))} />
              </td>
              <td className="num">{hoursOf(intervals)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="section-header">
        <h3>Feriados y excepciones</h3>
        <button className="btn btn-sm" onClick={() => setExceptions((l) => [...l, { day: '', name: 'Feriado', working: false, intervals: [] }])}>
          + Agregar fecha
        </button>
      </div>
      {exceptions.length === 0 && <p className="muted">Sin feriados registrados.</p>}
      {exceptions.length > 0 && (
        <table className="table">
          <thead><tr><th>Fecha</th><th>Descripción</th><th>Tipo</th><th>Jornada especial</th><th /></tr></thead>
          <tbody>
            {exceptions.map((e, i) => (
              <tr key={i}>
                <td>
                  <input type="date" value={e.day} onChange={(ev) => setException(i, { day: ev.target.value })} />
                  <div className="muted small">{e.day && formatLongDate(e.day)}</div>
                </td>
                <td><input value={e.name} maxLength={120} onChange={(ev) => setException(i, { name: ev.target.value })} /></td>
                <td>
                  <select value={e.working ? 'working' : 'holiday'}
                    onChange={(ev) => setException(i, ev.target.value === 'working'
                      ? { working: true, intervals: e.intervals.length ? e.intervals : [{ start: '08:00', end: '12:00' }] }
                      : { working: false })}>
                    <option value="holiday">Feriado / no laborable</option>
                    <option value="working">Día laborable especial</option>
                  </select>
                </td>
                <td>
                  {e.working ? (
                    <IntervalsEditor intervals={e.intervals}
                      onChange={(index, patch) => setException(i, { intervals: e.intervals.map((iv, k) => (k === index ? { ...iv, ...patch } : iv)) })}
                      onAdd={() => setException(i, { intervals: [...e.intervals, { start: '13:00', end: '17:00' }] })}
                      onRemove={(index) => setException(i, { intervals: e.intervals.filter((_, k) => k !== index) })} />
                  ) : <span className="muted">—</span>}
                </td>
                <td><button className="icon-btn danger" onClick={() => setExceptions((l) => l.filter((_, k) => k !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function IntervalsEditor({ intervals, onChange, onAdd, onRemove }: {
  intervals: Interval[]
  onChange: (index: number, patch: Partial<Interval>) => void
  onAdd: () => void
  onRemove: (index: number) => void
}) {
  if (intervals.length === 0) return <span className="muted">No laborable</span>
  return (
    <div className="intervals">
      {intervals.map((iv, i) => (
        <span key={i} className="interval">
          <input type="time" value={iv.start} onChange={(e) => onChange(i, { start: e.target.value })} />
          –
          <input type="time" value={iv.end} onChange={(e) => onChange(i, { end: e.target.value })} />
          <button className="icon-btn" onClick={() => onRemove(i)} title="Quitar intervalo">✕</button>
        </span>
      ))}
      {intervals.length < 4 && <button className="btn btn-sm" onClick={onAdd}>+ intervalo</button>}
    </div>
  )
}
