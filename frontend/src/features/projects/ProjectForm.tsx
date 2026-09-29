import { useLayoutEffect, useState, type FormEvent } from 'react'
import type { Methodology, ProjectInput, Settings, TimeUnit } from '../../api/types'
import { Button } from '../../components/Button'
import { Field } from '../../components/form/Field'
import { useDialogs } from '../../components/feedback/Dialogs'
import { useNotify } from '../../components/feedback/Notifications'
import { describeError } from '../../lib/errors'
import { METHODOLOGY_HINT, METHODOLOGY_LABEL, UNIT_LABEL } from '../../lib/labels'
import { MSG } from '../../lib/messages'
import { toIsoDate } from '../../lib/format'
import { errorList, first, rules, sameValues, useValidation, type Errors } from '../../lib/validation'

const DEFAULT_SETTINGS: Settings = {
  default_time_unit: 'day',
  default_task_duration: { value: 1, unit: 'day' },
  default_sprint_duration: { value: 2, unit: 'week' },
  hours_per_day: 8,
  days_per_week: 5,
  days_per_month: 20,
}

const UNITS: TimeUnit[] = ['hour', 'day', 'week', 'month']
const METHODOLOGIES: Methodology[] = ['traditional', 'agile', 'hybrid']
const LABELS: Record<string, string> = {
  name: 'Nombre', start_date: 'Fecha de inicio', target_date: 'Fecha objetivo', hours_per_day: 'Horas por día',
  days_per_week: 'Días por semana', days_per_month: 'Días por mes',
  default_task_duration: 'Duración de tarea', default_sprint_duration: 'Duración de sprint',
}

function validate(form: ProjectInput): Errors {
  const s = form.settings ?? DEFAULT_SETTINGS
  return {
    name: first(rules.required(form.name), rules.maxLength(form.name.trim(), 150)),
    start_date: rules.required(form.start_date),
    target_date: form.target_date && form.start_date && form.target_date < form.start_date
      ? 'No puede ser anterior a la fecha de inicio.' : undefined,
    hours_per_day: rules.range(s.hours_per_day, 0.5, 24),
    days_per_week: rules.range(s.days_per_week, 1, 7),
    days_per_month: rules.range(s.days_per_month, 1, 31),
    default_task_duration: rules.min(s.default_task_duration.value, 0),
    default_sprint_duration: rules.min(s.default_sprint_duration.value, 0),
  }
}

interface ProjectFormProps {
  /** Present when editing an existing project. */
  initial?: ProjectInput
  submitLabel: string
  busy?: boolean
  /** Must reject on failure so the form can show server field errors. */
  onSubmit: (input: ProjectInput) => Promise<unknown>
  onCancel?: () => void
  onDirtyChange?: (dirty: boolean) => void
}

export function ProjectForm({ initial, submitLabel, busy, onSubmit, onCancel, onDirtyChange }: ProjectFormProps) {
  const [start] = useState<ProjectInput>(() => initial ?? {
    name: '',
    description: '',
    methodology: 'hybrid',
    start_date: toIsoDate(new Date()),
    target_date: null,
    settings: DEFAULT_SETTINGS,
  })
  const [form, setForm] = useState<ProjectInput>(start)
  const { errors, attempt, setServerErrors, reset } = useValidation(form, validate)
  const notify = useNotify()
  const dialogs = useDialogs()
  const dirty = !sameValues(form, start)
  useLayoutEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])

  const settings = form.settings ?? DEFAULT_SETTINGS
  const set = <K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) => setForm((f) => ({ ...f, [key]: value }))
  const setSettings = (patch: Partial<Settings>) => set('settings', { ...settings, ...patch })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!attempt()) {
      notify.warning(MSG.fixFields(errorList(validate(form), LABELS)))
      return
    }
    if (initial && !dirty) {
      notify.info(MSG.noChanges)
      return
    }
    if (initial && form.methodology !== initial.methodology && !await dialogs.confirm({
      ...MSG.confirmMethodologyChange(METHODOLOGY_LABEL[initial.methodology], METHODOLOGY_LABEL[form.methodology]),
      tone: 'warning',
    })) return
    const before = initial?.settings?.hours_per_day
    if (initial && before !== undefined && before !== settings.hours_per_day && !await dialogs.confirm({
      ...MSG.confirmDayLengthChange(before, settings.hours_per_day),
      tone: 'warning',
    })) return
    try {
      await onSubmit({ ...form, name: form.name.trim(), description: form.description.trim(), target_date: form.target_date || null })
      reset()
    } catch (error) {
      setServerErrors(describeError(error).fields) // the notification is shown by the caller's mutation
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <Field label="Nombre del proyecto" required error={errors.name}>
        <input maxLength={150} value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
      </Field>
      <Field label="Descripción">
        <textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
      </Field>

      <fieldset className="field">
        <legend className="field-label">Metodología <span className="required">*</span></legend>
        <div className="method-cards">
          {METHODOLOGIES.map((m) => (
            <label key={m} className={`method-card ${form.methodology === m ? 'selected' : ''}`}>
              <input type="radio" name="methodology" checked={form.methodology === m} onChange={() => set('methodology', m)} />
              <strong>{METHODOLOGY_LABEL[m]}</strong>
              <small>{METHODOLOGY_HINT[m]}</small>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid-2">
        <Field label="Fecha de inicio" required error={errors.start_date}>
          <input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
        </Field>
        <Field label="Fecha objetivo" error={errors.target_date} hint="Opcional. Se usa para alertas y la probabilidad PERT.">
          <input type="date" value={form.target_date ?? ''} min={form.start_date}
            onChange={(e) => set('target_date', e.target.value || null)} />
        </Field>
      </div>

      <details className="advanced" open={Object.keys(LABELS).slice(3).some((k) => errors[k]) || undefined}>
        <summary>Parámetros de planificación</summary>
        <div className="grid-3">
          <Field label="Unidad temporal predeterminada">
            <select value={settings.default_time_unit}
              onChange={(e) => setSettings({ default_time_unit: e.target.value as TimeUnit })}>
              {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
            </select>
          </Field>
          <DurationField label="Duración predeterminada de tarea" value={settings.default_task_duration}
            error={errors.default_task_duration} onChange={(v) => setSettings({ default_task_duration: v })} />
          <DurationField label="Duración predeterminada de sprint" value={settings.default_sprint_duration}
            error={errors.default_sprint_duration} onChange={(v) => setSettings({ default_sprint_duration: v })} />
          <Field label="Horas laborables por día" error={errors.hours_per_day}>
            <input type="number" min={0.5} max={24} step={0.5} value={settings.hours_per_day}
              onChange={(e) => setSettings({ hours_per_day: Number(e.target.value) })} />
          </Field>
          <Field label="Días por semana" error={errors.days_per_week}>
            <input type="number" min={1} max={7} value={settings.days_per_week}
              onChange={(e) => setSettings({ days_per_week: Number(e.target.value) })} />
          </Field>
          <Field label="Días laborables por mes" error={errors.days_per_month}>
            <input type="number" min={1} max={31} value={settings.days_per_month}
              onChange={(e) => setSettings({ days_per_month: Number(e.target.value) })} />
          </Field>
        </div>
        <p className="hint">
          Internamente todo se calcula en minutos laborables. Estas equivalencias convierten horas, días, semanas y
          meses; las fechas reales las determina el calendario del proyecto.
        </p>
      </details>

      <div className="form-actions">
        {initial && dirty && <span className="dirty-badge">Cambios sin guardar</span>}
        {onCancel && <Button type="button" onClick={onCancel} disabled={busy}>Cancelar</Button>}
        {initial && dirty && <Button type="button" onClick={() => { setForm(start); reset() }} disabled={busy}>Descartar cambios</Button>}
        <Button type="submit" variant="primary" loading={busy} loadingText="Guardando…">{submitLabel}</Button>
      </div>
    </form>
  )
}

function DurationField({ label, value, error, onChange }: {
  label: string
  value: { value: number; unit: TimeUnit }
  error?: string
  onChange: (v: { value: number; unit: TimeUnit }) => void
}) {
  return (
    <Field label={label} error={error}>
      <div className="input-group">
        <input type="number" min={0} step={0.5} value={value.value}
          onChange={(e) => onChange({ ...value, value: Number(e.target.value) })} />
        <select value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value as TimeUnit })}>
          {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
        </select>
      </div>
    </Field>
  )
}
