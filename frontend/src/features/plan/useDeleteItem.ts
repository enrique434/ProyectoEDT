import { api } from '../../api/client'
import { useProjectMutation } from '../../api/hooks'
import type { DeletionStrategy, Project, WorkItem } from '../../api/types'
import { useDialogs } from '../../components/feedback/Dialogs'
import { MSG } from '../../lib/messages'
import { descendantIds } from '../../lib/wbs'

interface DeleteArgs {
  item: WorkItem
  nested: number
  strategy: DeletionStrategy
}

/**
 * RN-28 delete flow. The consequences are computed up front, so the user sees what will be removed
 * and, when the activity has dependencies, chooses how to resolve them in the same dialog.
 */
export function useDeleteItem(project: Project, onDeleted?: () => void) {
  const dialogs = useDialogs()
  const mutation = useProjectMutation(project.id,
    (a: DeleteArgs) => api.deleteItem(project.id, a.item.id, a.strategy), {
      success: (_, a) => MSG.itemDeleted(a.item, a.nested, a.strategy),
      error: (a) => `No se pudo eliminar “${a.item.name}”`,
    })

  const requestDelete = async (item: WorkItem) => {
    const subtree = descendantIds(project.items, item.id)
    const nested = subtree.size - 1
    const assignments = project.items.filter((i) => subtree.has(i.id)).reduce((n, i) => n + i.assignments.length, 0)
    const names = new Map(project.items.map((i) => [i.id, i.name]))
    const external = project.dependencies.filter((d) => subtree.has(d.predecessor_id) !== subtree.has(d.successor_id))

    let strategy: DeletionStrategy | null = 'reject'
    if (external.length > 0) {
      // Reconnecting only makes sense when there is something on both sides of the activity.
      const canBridge = external.some((d) => subtree.has(d.successor_id)) && external.some((d) => subtree.has(d.predecessor_id))
      strategy = await dialogs.choose<DeletionStrategy>({
        ...MSG.resolveDependencies(item, nested, external.map((d) => MSG.describeDependency(d, names))),
        tone: 'warning',
        choices: [
          { value: 'remove', label: 'Eliminar con sus dependencias', variant: 'danger',
            description: 'Las actividades relacionadas quedan sin esa relación.' },
          ...(canBridge ? [{ value: 'bridge' as const, label: 'Eliminar y reconectar', variant: 'primary' as const,
            description: 'Cada predecesora se conecta (FS) con cada sucesora para conservar la secuencia.' }] : []),
        ],
      })
    } else if (!await dialogs.confirm({ ...MSG.confirmDeleteItem(item, nested, assignments), tone: 'danger' })) {
      strategy = null
    }
    if (strategy) mutation.mutate({ item, nested, strategy }, { onSuccess: onDeleted })
  }

  return { requestDelete, isDeleting: mutation.isPending }
}
