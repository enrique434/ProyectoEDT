import { useState, type FormEvent } from 'react'
import type { Methodology, ProjectInput, Settings, TimeUnit } from '../../api/types'
import { METHODOLOGY_HINT, METHODOLOGY_LABEL, UNIT_LABEL } from '../../lib/labels'
import { toIsoDate } from '../../lib/format'

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

interface ProjectFormProps {
  initial?: ProjectInput
  submitLabel: string
  busy?: boolean
  onSubmit: (input: ProjectInput) => void
  onCancel?: () => void
}

export function ProjectForm({ initial, submitLabel, busy, onSubmit, onCancel }: ProjectFormProps) {
  const [form, setForm] = useState<ProjectInput>(
    initial ?? {
      name: '',
      description: '',
      methodology: 'hybrid',
      start_date: toIsoDate(new Date()),
      target_date: null,
      settings: DEFAULT_SETTINGS,
    },
  )
  const settings = form.settings ?? DEFAULT_SETTINGS
  const set = <K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) => setForm((f) => ({ ...f, [key]: value }))
  const setSettings = (patch: Partial<Settings>) => set('settings', { ...settings, ...patch })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSubmit({ ...form, name: form.name.trim(), target_date: form.target_date || null })
  }

  return (
    <form className="form" onSubmit={submit}>
      <label className="field">
        <span>Nombre del proyecto *</span>
        <input required maxLength={150} value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
      </label>
      <label className="field">
        <span>Descripción</span>
        <textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
      </label>

      <fieldset className="field">
        <legend>Metodología *</legend>
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
        <label className="field">
          <span>Fecha de inicio *</span>
          <input type="date" required value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
        </label>
        <label className="field">
          <span>Fecha objetivo</span>
          <input type="date" value={form.target_date ?? ''} min={form.start_date}
            onChange={(e) => set('target_date', e.target.value || null)} />
        </label>
      </div>

      <details className="advanced">
        <summary>Parámetros de planificación</summary>
        <div className="grid-3">
          <label className="field">
            <span>Unidad temporal predeterminada</span>
            <select value={settings.default_time_unit}
              onChange={(e) => setSettings({ default_time_unit: e.target.value as TimeUnit })}>
              {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
            </select>
          </label>
          <DurationField label="Duración predeterminada de tarea" value={settings.default_task_duration}
            onChange={(v) => setSettings({ default_task_duration: v })} />
          <DurationField label="Duración predeterminada de sprint" value={settings.default_sprint_duration}
            onChange={(v) => setSettings({ default_sprint_duration: v })} />
          <label className="field">
            <span>Horas laborables por día</span>
            <input type="number" min={0.5} max={24} step={0.5} value={settings.hours_per_day}
              onChange={(e) => setSettings({ hours_per_day: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Días por semana</span>
            <input type="number" min={1} max={7} value={settings.days_per_week}
              onChange={(e) => setSettings({ days_per_week: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Días laborables por mes</span>
            <input type="number" min={1} max={31} value={settings.days_per_month}
              onChange={(e) => setSettings({ days_per_month: Number(e.target.value) })} />
          </label>
        </div>
        <p className="hint">
          Internamente todo se calcula en minutos laborables. Estas equivalencias convierten horas, días, semanas y
          meses; las fechas reales las determina el calendario del proyecto.
        </p>
      </details>

      <div className="form-actions">
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancelar</button>}
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : submitLabel}</button>
      </div>
    </form>
  )
}

function DurationField({ label, value, onChange }: {
  label: string
  value: { value: number; unit: TimeUnit }
  onChange: (v: { value: number; unit: TimeUnit }) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-group">
        <input type="number" min={0} step={0.5} value={value.value}
          onChange={(e) => onChange({ ...value, value: Number(e.target.value) })} />
        <select value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value as TimeUnit })}>
          {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
        </select>
      </div>
    </label>
  )
}
