import { useState } from 'react'
import { api } from '../../api/client'
import { useProjectMutation } from '../../api/hooks'
import type { CalendarInput, Interval, Project } from '../../api/types'
import { Button } from '../../components/Button'
import { Alert } from '../../components/feedback/Alert'
import { useNotify } from '../../components/feedback/Notifications'
import { useUnsavedChanges } from '../../components/feedback/UnsavedChanges'
import { InlineError } from '../../components/form/Field'
import { WEEKDAY_LABEL } from '../../lib/labels'
import { MSG } from '../../lib/messages'
import { formatLongDate } from '../../lib/format'
import { hasErrors, sameValues, type Errors } from '../../lib/validation'

interface ExceptionDraft {
  day: string
  name: string
  working: boolean
  intervals: Interval[]
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
const minutesOf = (iv: Interval) => toMinutes(iv.end) - toMinutes(iv.start)
const hoursOf = (intervals: Interval[]) => intervals.reduce((acc, iv) => acc + Math.max(0, minutesOf(iv)), 0) / 60
const DEFAULT_DAY: Interval[] = [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }]

/** Same rules as the backend WorkCalendar: end after start, no overlaps. */
function intervalsError(intervals: Interval[]): string | undefined {
  if (intervals.some((iv) => !iv.start || !iv.end)) return 'Complete las horas de inicio y fin.'
  if (intervals.some((iv) => minutesOf(iv) <= 0)) return 'La hora de fin debe ser posterior a la de inicio.'
  const sorted = [...intervals].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
  if (sorted.some((iv, i) => i > 0 && toMinutes(iv.start) < toMinutes(sorted[i - 1].end))) return 'Los intervalos se solapan.'
  return undefined
}

function validate(week: Interval[][], exceptions: ExceptionDraft[]): Errors {
  const errors: Errors = {}
  week.forEach((intervals, day) => { errors[`day-${day}`] = intervalsError(intervals) })
  if (week.every((intervals) => intervals.length === 0)) errors.week = 'Debe haber al menos un día laborable en la semana.'
  const seen = new Map<string, number>()
  exceptions.forEach((e, i) => {
    const duplicate = e.day && seen.has(e.day)
    if (e.day) seen.set(e.day, i)
    errors[`exc-${i}`] = !e.day ? 'Seleccione la fecha.'
      : duplicate ? 'Esta fecha ya está registrada.'
      : !e.name.trim() ? 'Escriba una descripción.'
      : e.working && e.intervals.length === 0 ? 'Un día laborable especial necesita al menos un intervalo.'
      : e.working ? intervalsError(e.intervals) : undefined
  })
  return errors
}

/** CU-04: weekly working pattern, holidays and exceptions of this project only (RN-02). */
export function CalendarView({ project }: { project: Project }) {
  const notify = useNotify()
  const [initialWeek] = useState<Interval[][]>(() =>
    Array.from({ length: 7 }, (_, d) => project.calendar.week[String(d)]?.map((iv) => ({ ...iv })) ?? []))
  const [initialExceptions] = useState<ExceptionDraft[]>(() =>
    project.calendar.exceptions.map((e) => ({ day: e.day, name: e.name, working: e.is_working, intervals: e.intervals })))
  const [week, setWeek] = useState(initialWeek)
  const [exceptions, setExceptions] = useState(initialExceptions)
  const [attempted, setAttempted] = useState(false)
  const save = useProjectMutation(project.id, (input: CalendarInput) => api.updateCalendar(project.id, input), {
    success: () => MSG.calendarSaved,
    error: 'No se pudo guardar el calendario',
  })

  const dirty = !sameValues([week, exceptions], [initialWeek, initialExceptions])
  useUnsavedChanges('calendar', dirty)
  const allErrors = validate(week, exceptions)
  const errors = attempted ? allErrors : {}

  const setDay = (day: number, intervals: Interval[]) => setWeek((w) => w.map((v, i) => (i === day ? intervals : v)))
  const setInterval = (day: number, index: number, patch: Partial<Interval>) =>
    setDay(day, week[day].map((iv, i) => (i === index ? { ...iv, ...patch } : iv)))
  const setException = (index: number, patch: Partial<ExceptionDraft>) =>
    setExceptions((list) => list.map((e, i) => (i === index ? { ...e, ...patch } : e)))

  const submit = () => {
    setAttempted(true)
    if (hasErrors(allErrors)) {
      const details = Object.entries(allErrors).filter(([, m]) => m).map(([key, message]) => {
        const [kind, index] = key.split('-')
        if (kind === 'day') return `${WEEKDAY_LABEL[Number(index)]}: ${message}`
        if (kind === 'exc') return `Excepción ${exceptions[Number(index)].day || `#${Number(index) + 1}`}: ${message}`
        return message!
      })
      notify.warning(MSG.fixFields(details))
      return
    }
    if (!dirty) return notify.info(MSG.noChanges)
    save.mutate({
      week: week.map((intervals, weekday) => ({ weekday, intervals })),
      exceptions: exceptions.map((e) => ({ day: e.day, name: e.name.trim(), intervals: e.working ? e.intervals : [] })),
    })
  }
  const discard = () => {
    setWeek(initialWeek)
    setExceptions(initialExceptions)
    setAttempted(false)
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
        <div className="actions">
          {dirty && <span className="dirty-badge">Cambios sin guardar</span>}
          {dirty && <Button onClick={discard} disabled={save.isPending}>Descartar cambios</Button>}
          <Button variant="primary" onClick={submit} loading={save.isPending} loadingText="Guardando…">Guardar calendario</Button>
        </div>
      </div>

      {errors.week && <Alert tone="error" compact>{errors.week}</Alert>}
      {weeklyHours > 0 && Math.abs(weeklyHours / Math.max(1, week.filter((d) => d.length).length) - project.settings.hours_per_day) > 0.01 && (
        <Alert tone="info" compact title="Jornada distinta a la configuración">
          La jornada promedio del calendario ({Math.round(weeklyHours / week.filter((d) => d.length).length * 100) / 100} h) difiere de las
          {' '}{project.settings.hours_per_day} h/día usadas para convertir “1 día” en la configuración del proyecto.
        </Alert>
      )}

      <table className="table calendar-table">
        <thead><tr><th>Día</th><th>Laborable</th><th>Jornada (intervalos)</th><th className="num">Horas</th></tr></thead>
        <tbody>
          {week.map((intervals, day) => (
            <tr key={day} className={`${intervals.length ? '' : 'inactive'} ${errors[`day-${day}`] ? 'row-error' : ''}`}>
              <td><strong>{WEEKDAY_LABEL[day]}</strong></td>
              <td>
                <input type="checkbox" checked={intervals.length > 0} aria-label={`${WEEKDAY_LABEL[day]} laborable`}
                  onChange={(e) => setDay(day, e.target.checked ? DEFAULT_DAY.map((iv) => ({ ...iv })) : [])} />
              </td>
              <td>
                <IntervalsEditor intervals={intervals}
                  onChange={(index, patch) => setInterval(day, index, patch)}
                  onAdd={() => setDay(day, [...intervals, { start: '18:00', end: '20:00' }])}
                  onRemove={(index) => setDay(day, intervals.filter((_, i) => i !== index))} />
                <InlineError>{errors[`day-${day}`]}</InlineError>
              </td>
              <td className="num">{hoursOf(intervals)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="section-header">
        <h3>Feriados y excepciones</h3>
        <Button size="sm" onClick={() => setExceptions((l) => [...l, { day: '', name: 'Feriado', working: false, intervals: [] }])}>
          + Agregar fecha
        </Button>
      </div>
      {exceptions.length === 0 && <p className="muted">Sin feriados registrados.</p>}
      {exceptions.length > 0 && (
        <table className="table">
          <thead><tr><th>Fecha</th><th>Descripción</th><th>Tipo</th><th>Jornada especial</th><th /></tr></thead>
          <tbody>
            {exceptions.map((e, i) => (
              <tr key={i} className={errors[`exc-${i}`] ? 'row-error' : ''}>
                <td>
                  <input type="date" value={e.day} aria-label="Fecha" className={errors[`exc-${i}`] && !e.day ? 'invalid' : ''}
                    onChange={(ev) => setException(i, { day: ev.target.value })} />
                  <div className="muted small">{e.day && formatLongDate(e.day)}</div>
                </td>
                <td>
                  <input value={e.name} maxLength={120} aria-label="Descripción" onChange={(ev) => setException(i, { name: ev.target.value })} />
                  <InlineError>{errors[`exc-${i}`]}</InlineError>
                </td>
                <td>
                  <select value={e.working ? 'working' : 'holiday'} aria-label="Tipo"
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
                <td>
                  <button className="icon-btn danger" title="Quitar fecha (se aplica al guardar)" aria-label="Quitar fecha"
                    onClick={() => setExceptions((l) => l.filter((_, k) => k !== i))}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint">Los cambios de esta página se aplican al pulsar “Guardar calendario”; hasta entonces puede descartarlos.</p>
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
          <input type="time" value={iv.start} aria-label="Hora de inicio" onChange={(e) => onChange(i, { start: e.target.value })} />
          –
          <input type="time" value={iv.end} aria-label="Hora de fin" onChange={(e) => onChange(i, { end: e.target.value })} />
          <button className="icon-btn" onClick={() => onRemove(i)} title="Quitar intervalo" aria-label="Quitar intervalo">✕</button>
        </span>
      ))}
      {intervals.length < 4 && <Button size="sm" onClick={onAdd}>+ intervalo</Button>}
    </div>
  )
}
