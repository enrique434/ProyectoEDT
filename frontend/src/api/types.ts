// Contracts of the REST API (mirror of backend/app/api/schemas.py).

export type Methodology = 'traditional' | 'agile' | 'hybrid'
export type WorkItemKind = 'phase' | 'sprint' | 'story' | 'task' | 'subtask' | 'milestone'
export type ItemStatus = 'not_started' | 'in_progress' | 'completed' | 'on_hold' | 'cancelled'
export type Priority = 'low' | 'medium' | 'high' | 'critical'
export type EstimationMode = 'manual' | 'pert'
export type ConstraintType = 'asap' | 'snet' | 'fnet'
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF'
export type TimeUnit = 'hour' | 'day' | 'week' | 'month'
export type DeletionStrategy = 'reject' | 'remove' | 'bridge'

export interface Duration {
  value: number
  unit: TimeUnit
}

export interface Settings {
  default_time_unit: TimeUnit
  default_task_duration: Duration
  default_sprint_duration: Duration
  hours_per_day: number
  days_per_week: number
  days_per_month: number
}

export interface SettingsOut extends Settings {
  minutes_per_day: number
}

export interface Interval {
  start: string
  end: string
}

export interface CalendarException {
  day: string
  name: string
  is_working: boolean
  intervals: Interval[]
}

export interface Calendar {
  week: Record<string, Interval[]>
  exceptions: CalendarException[]
}

export interface Role {
  id: string
  name: string
  description: string
}

export interface Member {
  id: string
  name: string
  role_id: string | null
  email: string
  responsibility: string
  hours_per_day: number
  active: boolean
}

export interface Pert {
  optimistic: number
  most_likely: number
  pessimistic: number
  expected: number
  std_dev: number
}

export interface ItemSchedule {
  start: string
  finish: string
  early_start: number
  early_finish: number
  late_start: number
  late_finish: number
  total_float: number
  free_float: number
  is_critical: boolean
}

export interface Allocation {
  member_id: string
  units: number
}

export interface WorkItem {
  id: string
  parent_id: string | null
  row: number
  wbs_code: string
  level: number
  kind: WorkItemKind
  name: string
  description: string
  objective: string
  is_summary: boolean
  duration_minutes: number
  duration_value: number
  duration_unit: TimeUnit
  estimation_mode: EstimationMode
  pert: Pert | null
  constraint_type: ConstraintType
  constraint_date: string | null
  status: ItemStatus
  priority: Priority
  progress: number
  assignments: Allocation[]
  schedule: ItemSchedule | null
}

export interface Dependency {
  id: string
  predecessor_id: string
  successor_id: string
  type: DependencyType
  lag_minutes: number
  lag_value: number
  lag_unit: TimeUnit
}

export interface ScheduleSummary {
  start: string
  finish: string
  duration_minutes: number
  duration_days: number
  critical_item_ids: string[]
  pert_std_dev_minutes: number
  target_probability: number | null
  warnings: string[]
  calculated_at: string
}

export interface Project {
  id: string
  name: string
  description: string
  methodology: Methodology
  start_date: string
  target_date: string | null
  settings: SettingsOut
  calendar: Calendar
  allowed_children: Record<string, WorkItemKind[]>
  roles: Role[]
  members: Member[]
  items: WorkItem[]
  dependencies: Dependency[]
  schedule: ScheduleSummary | null
  created_at: string
  updated_at: string
}

export interface ProjectListItem {
  id: string
  name: string
  description: string
  methodology: Methodology
  start_date: string
  target_date: string | null
  finish: string | null
  item_count: number
  updated_at: string
}

export interface Created {
  id: string
  project: Project
}

export interface MemberLoad {
  member_id: string
  name: string
  active: boolean
  capacity_minutes_per_day: number
  total_minutes: number
  overallocated_days: number
  days: { day: string; minutes: number; overallocated: boolean }[]
}

export interface ProjectInput {
  name: string
  description: string
  methodology: Methodology
  start_date: string
  target_date: string | null
  settings?: Settings
}

export interface ItemCreateInput {
  kind: WorkItemKind
  name: string
  parent_id: string | null
  duration_value?: number
  duration_unit?: TimeUnit
}

export interface ItemUpdateInput {
  name?: string
  description?: string
  objective?: string
  kind?: WorkItemKind
  estimation_mode?: EstimationMode
  duration_value?: number
  duration_unit?: TimeUnit
  pert?: { optimistic: number; most_likely: number; pessimistic: number }
  constraint_type?: ConstraintType
  constraint_date?: string | null
  status?: ItemStatus
  priority?: Priority
  progress?: number
}

export interface DependencyInput {
  predecessor_id: string
  successor_id: string
  type: DependencyType
  lag_value: number
  lag_unit: TimeUnit
}

export interface MemberInput {
  name: string
  role_id: string | null
  email: string
  responsibility: string
  hours_per_day: number
  active: boolean
}

export interface CalendarInput {
  week: { weekday: number; intervals: Interval[] }[]
  exceptions: { day: string; name: string; intervals: Interval[] }[]
}
