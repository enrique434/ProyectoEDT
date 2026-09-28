import type { Project, WorkItem, WorkItemKind } from '../api/types'

export const ROOT_KEY = 'root'

/** Items visible in the outline when some summaries are collapsed. Items arrive in outline order. */
export function visibleItems(items: WorkItem[], collapsed: Set<string>): WorkItem[] {
  const hidden = new Set<string>()
  return items.filter((item) => {
    if (item.parent_id && (hidden.has(item.parent_id) || collapsed.has(item.parent_id))) {
      hidden.add(item.id)
      return false
    }
    return true
  })
}

export function allowedChildren(project: Project, parent: WorkItem | null): WorkItemKind[] {
  return project.allowed_children[parent ? parent.kind : ROOT_KEY] ?? []
}

export interface InsertionTarget {
  parentId: string | null
  kind: WorkItemKind
}

/**
 * Where a new item of `kind` goes given the selected row: inside the selection when allowed,
 * otherwise as a sibling of the selection, otherwise inside one of its ancestors, otherwise at the root.
 */
export function insertionTarget(project: Project, selected: WorkItem | null, kind: WorkItemKind): InsertionTarget | null {
  const byId = new Map(project.items.map((i) => [i.id, i]))
  let container: WorkItem | null = selected
  while (container) {
    if (allowedChildren(project, container).includes(kind)) return { parentId: container.id, kind }
    container = container.parent_id ? byId.get(container.parent_id) ?? null : null
  }
  return allowedChildren(project, null).includes(kind) ? { parentId: null, kind } : null
}

export function descendantIds(items: WorkItem[], id: string): Set<string> {
  const result = new Set<string>([id])
  for (const item of items) {
    if (item.parent_id && result.has(item.parent_id)) result.add(item.id)
  }
  return result
}

export function memberNames(project: Project, item: WorkItem): string {
  const names = new Map(project.members.map((m) => [m.id, m.name]))
  return item.assignments
    .map((a) => `${names.get(a.member_id) ?? '?'}${a.units < 100 ? ` [${a.units}%]` : ''}`)
    .join(', ')
}
