import type { ReactNode } from 'react'
import { ToneIcon } from '../feedback/icons'

interface FieldProps {
  label: ReactNode
  children: ReactNode
  error?: string
  hint?: ReactNode
  required?: boolean
  className?: string
}

/** Label + control + inline error/hint. Every form uses it so errors look and read the same everywhere. */
export function Field({ label, children, error, hint, required, className = '' }: FieldProps) {
  return (
    <label className={`field ${error ? 'has-error' : ''} ${className}`}>
      <span className="field-label">{label}{required && <span className="required" aria-hidden="true"> *</span>}</span>
      {children}
      {error ? (
        <span className="field-error" role="alert"><ToneIcon tone="error" size={14} />{error}</span>
      ) : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

/** Error message for controls that are not wrapped in a <Field> (tables, compound inputs). */
export function InlineError({ children }: { children?: ReactNode }) {
  if (!children) return null
  return <span className="field-error" role="alert"><ToneIcon tone="error" size={14} />{children}</span>
}
