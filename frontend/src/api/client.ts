// Thin HTTP client: one function per endpoint, no UI concerns.
import type {
  CalendarInput,
  Created,
  DeletionStrategy,
  DependencyInput,
  DependencyType,
  ItemCreateInput,
  ItemUpdateInput,
  MemberInput,
  MemberLoad,
  Methodology,
  Project,
  ProjectInput,
  ProjectListItem,
  TimeUnit,
} from './types'

/** A field-level problem reported by the API ({field: "settings.hours_per_day", label, message}). */
export interface FieldProblem {
  field: string
  label: string
  message: string
}

/**
 * Every failure of a request becomes an ApiError with a stable `code`:
 * API codes (invalid_request, dependency_cycle, not_found, …) plus `network_error` and `server_unavailable`.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly payload: Record<string, unknown>

  constructor(status: number, payload: Record<string, unknown>) {
    super(typeof payload.message === 'string' ? payload.message : ApiError.fallbackMessage(status))
    this.status = status
    this.code = typeof payload.code === 'string' ? payload.code : status >= 500 ? 'server_unavailable' : 'http_error'
    this.payload = payload
  }

  get fieldProblems(): FieldProblem[] {
    return Array.isArray(this.payload.errors) ? (this.payload.errors as FieldProblem[]) : []
  }

  private static fallbackMessage(status: number): string {
    if (status >= 500) return 'El servidor no está disponible en este momento. Inténtelo de nuevo en unos segundos.'
    if (status === 404) return 'El recurso solicitado no existe.'
    return 'La solicitud no pudo procesarse.'
  }
}

const NETWORK_ERROR = {
  code: 'network_error',
  message: 'No se pudo conectar con el servidor. Verifique que el backend esté en ejecución y su conexión de red.',
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, NETWORK_ERROR)
  }
  if (response.status === 204) return undefined as T
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(response.status, data)
  return data as T
}

const project = (id: string) => `/projects/${id}`

export const api = {
  listProjects: () => request<ProjectListItem[]>('GET', '/projects'),
  getProject: (id: string) => request<Project>('GET', project(id)),
  createProject: (input: ProjectInput) => request<Project>('POST', '/projects', input),
  createSample: (methodology: Methodology, start_date: string) =>
    request<Project>('POST', '/projects/samples', { methodology, start_date }),
  updateProject: (id: string, input: ProjectInput) => request<Project>('PUT', project(id), input),
  deleteProject: (id: string) => request<void>('DELETE', project(id)),
  recalculate: (id: string) => request<Project>('POST', `${project(id)}/schedule`),
  updateCalendar: (id: string, input: CalendarInput) => request<Project>('PUT', `${project(id)}/calendar`, input),
  resourceLoad: (id: string) => request<MemberLoad[]>('GET', `${project(id)}/resource-load`),

  createItem: (id: string, input: ItemCreateInput) => request<Created>('POST', `${project(id)}/items`, input),
  updateItem: (id: string, itemId: string, input: ItemUpdateInput) =>
    request<Project>('PUT', `${project(id)}/items/${itemId}`, input),
  moveItem: (id: string, itemId: string, parent_id: string | null, position: number | null) =>
    request<Project>('POST', `${project(id)}/items/${itemId}/move`, { parent_id, position }),
  deleteItem: (id: string, itemId: string, strategy: DeletionStrategy) =>
    request<Project>('DELETE', `${project(id)}/items/${itemId}?strategy=${strategy}`),
  setAssignments: (id: string, itemId: string, assignments: { member_id: string; units: number }[]) =>
    request<Project>('PUT', `${project(id)}/items/${itemId}/assignments`, { assignments }),

  createDependency: (id: string, input: DependencyInput) =>
    request<Created>('POST', `${project(id)}/dependencies`, input),
  updateDependency: (id: string, depId: string, type: DependencyType, lag_value: number, lag_unit: TimeUnit) =>
    request<Project>('PUT', `${project(id)}/dependencies/${depId}`, { type, lag_value, lag_unit }),
  deleteDependency: (id: string, depId: string) => request<Project>('DELETE', `${project(id)}/dependencies/${depId}`),

  createRole: (id: string, name: string, description: string) =>
    request<Created>('POST', `${project(id)}/roles`, { name, description }),
  updateRole: (id: string, roleId: string, name: string, description: string) =>
    request<Project>('PUT', `${project(id)}/roles/${roleId}`, { name, description }),
  deleteRole: (id: string, roleId: string) => request<Project>('DELETE', `${project(id)}/roles/${roleId}`),
  createMember: (id: string, input: MemberInput) => request<Created>('POST', `${project(id)}/members`, input),
  updateMember: (id: string, memberId: string, input: MemberInput) =>
    request<Project>('PUT', `${project(id)}/members/${memberId}`, input),
  deleteMember: (id: string, memberId: string) => request<Project>('DELETE', `${project(id)}/members/${memberId}`),
}
