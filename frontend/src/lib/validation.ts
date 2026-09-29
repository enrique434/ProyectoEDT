// Client-side validation shared by all forms. It mirrors the backend rules so the user gets
// immediate, field-level feedback; the backend remains the final authority.
import { useEffect, useMemo, useRef, useState } from 'react'

export type Errors = Record<string, string | undefined>

export const rules = {
  required: (value: string | null | undefined): string | undefined =>
    value && String(value).trim() ? undefined : 'Es obligatorio.',
  maxLength: (value: string, max: number): string | undefined =>
    value.length > max ? `Admite como máximo ${max} caracteres.` : undefined,
  range: (value: number, min: number, max: number): string | undefined =>
    Number.isFinite(value) && value >= min && value <= max ? undefined : `Debe estar entre ${min} y ${max}.`,
  min: (value: number, min: number): string | undefined =>
    Number.isFinite(value) && value >= min ? undefined : `Debe ser mayor o igual a ${min}.`,
  number: (value: number): string | undefined => (Number.isFinite(value) ? undefined : 'Debe ser un número.'),
  email: (value: string): string | undefined =>
    !value.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? undefined : 'No es un correo válido.',
}

/** First failing rule, or undefined. */
export function first(...checks: (string | undefined)[]): string | undefined {
  return checks.find(Boolean)
}

export function hasErrors(errors: Errors): boolean {
  return Object.values(errors).some(Boolean)
}

/** "Nombre: Es obligatorio." lines for the error notification. */
export function errorList(errors: Errors, labels: Record<string, string>): string[] {
  return Object.entries(errors)
    .filter(([, message]) => message)
    .map(([key, message]) => `${labels[key] ?? key}: ${message}`)
}

/**
 * Errors are shown after the first save attempt and then update live while the user fixes them.
 * Field errors returned by the server are merged in and cleared as soon as the values change.
 */
export function useValidation<T>(values: T, validate: (values: T) => Errors) {
  const [attempted, setAttempted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Errors>({})
  const clientErrors = useMemo(() => validate(values), [values, validate])
  const lastValues = useRef(values)

  useEffect(() => {
    if (lastValues.current !== values) {
      lastValues.current = values
      setServerErrors({})
    }
  }, [values])

  return {
    errors: { ...(attempted ? clientErrors : {}), ...serverErrors } as Errors,
    clientErrors,
    /** Marks the form as submitted; returns true when it can be sent. */
    attempt: () => {
      setAttempted(true)
      return !hasErrors(clientErrors)
    },
    setServerErrors,
    reset: () => {
      setAttempted(false)
      setServerErrors({})
    },
  }
}

/** Shallow structural equality for "is there anything to save?" checks. */
export function sameValues(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
