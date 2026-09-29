// Turns any failure into something a person can read: a title, a reason and optional details.
import { ApiError } from '../api/client'

export interface ErrorDescription {
  title: string
  message: string
  details: string[]
  /** Field errors keyed by the last segment of the API path ("hours_per_day"). */
  fields: Record<string, string>
}

const TITLES: Record<string, string> = {
  network_error: 'Sin conexión con el servidor',
  server_unavailable: 'Servidor no disponible',
  internal_error: 'Error inesperado',
  invalid_request: 'Datos no válidos',
  validation_error: 'Regla de negocio no cumplida',
  hierarchy_rule: 'Estructura no permitida',
  dependency_cycle: 'Dependencia circular',
  dependency_conflict: 'La actividad tiene dependencias',
  not_found: 'Registro no encontrado',
}

/**
 * @param context what the user was trying to do ("No se pudo guardar el calendario").
 *                It becomes the title; the reason from the server becomes the message.
 */
export function describeError(error: unknown, context?: string): ErrorDescription {
  if (error instanceof ApiError) {
    const problems = error.fieldProblems
    return {
      title: context ?? TITLES[error.code] ?? 'No se pudo completar la acción',
      message: error.message,
      details: problems.map((p) => `${p.label}: ${p.message}`),
      fields: Object.fromEntries(problems.map((p) => [p.field.split('.').pop() ?? p.field, p.message])),
    }
  }
  return {
    title: context ?? 'Error inesperado',
    message: error instanceof Error ? error.message : 'Ocurrió un problema inesperado en la aplicación.',
    details: [],
    fields: {},
  }
}

export function isApiError(error: unknown, code: string): error is ApiError {
  return error instanceof ApiError && error.code === code
}
