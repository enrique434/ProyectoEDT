import type {
  ConstraintType,
  DependencyType,
  EstimationMode,
  ItemStatus,
  Methodology,
  Priority,
  TimeUnit,
  WorkItemKind,
} from '../api/types'

export const METHODOLOGY_LABEL: Record<Methodology, string> = {
  traditional: 'Tradicional',
  agile: 'Ágil',
  hybrid: 'Híbrido',
}

export const METHODOLOGY_HINT: Record<Methodology, string> = {
  traditional: 'Proyecto → Fases → Tareas → Subtareas',
  agile: 'Proyecto → Sprints → Historias/Tareas → Subtareas',
  hybrid: 'Proyecto → Fases → (Tareas | Sprints → Tareas) → Subtareas',
}

export const KIND_LABEL: Record<WorkItemKind, string> = {
  phase: 'Fase',
  sprint: 'Sprint',
  story: 'Historia',
  task: 'Tarea',
  subtask: 'Subtarea',
  milestone: 'Hito',
}

export const KIND_ORDER: WorkItemKind[] = ['phase', 'sprint', 'story', 'task', 'subtask', 'milestone']

export const STATUS_LABEL: Record<ItemStatus, string> = {
  not_started: 'No iniciada',
  in_progress: 'En progreso',
  completed: 'Completada',
  on_hold: 'En espera',
  cancelled: 'Cancelada',
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  critical: 'Crítica',
}

export const UNIT_LABEL: Record<TimeUnit, string> = {
  hour: 'horas',
  day: 'días',
  week: 'semanas',
  month: 'meses',
}

export const UNIT_SHORT: Record<TimeUnit, string> = { hour: 'h', day: 'd', week: 'sem', month: 'mes' }

export const DEPENDENCY_LABEL: Record<DependencyType, string> = {
  FS: 'FS · Fin → Inicio',
  SS: 'SS · Inicio → Inicio',
  FF: 'FF · Fin → Fin',
  SF: 'SF · Inicio → Fin',
}

export const CONSTRAINT_LABEL: Record<ConstraintType, string> = {
  asap: 'Lo antes posible (calculada)',
  snet: 'No comenzar antes de',
  fnet: 'No terminar antes de',
}

export const ESTIMATION_LABEL: Record<EstimationMode, string> = {
  manual: 'Manual',
  pert: 'PERT (3 puntos)',
}

export const WEEKDAY_LABEL = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
