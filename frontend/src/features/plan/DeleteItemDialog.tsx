import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../../api/client'
import { projectKey } from '../../api/hooks'
import type { DeletionStrategy, Project, WorkItem } from '../../api/types'
import { Modal } from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { KIND_LABEL } from '../../lib/labels'
import { descendantIds } from '../../lib/wbs'

interface Props {
  project: Project
  item: WorkItem
  onClose: () => void
}

/** RN-28: deleting an activity with dependencies requires choosing how to resolve them. */
export function DeleteItemDialog({ project, item, onClose }: Props) {
  const client = useQueryClient()
  const toast = useToast()
  const [conflict, setConflict] = useState<{ predecessor_id: string; successor_id: string }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const subtree = descendantIds(project.items, item.id)
  const names = new Map(project.items.map((i) => [i.id, i.name]))

  const run = async (strategy: DeletionStrategy) => {
    setBusy(true)
    try {
      const updated = await api.deleteItem(project.id, item.id, strategy)
      client.setQueryData(projectKey(project.id), updated)
      client.invalidateQueries({ queryKey: ['projects'] })
      toast.success(`"${item.name}" eliminado`)
      onClose()
    } catch (error) {
      if (error instanceof ApiError && error.code === 'dependency_conflict') {
        setConflict(error.payload.dependencies as { predecessor_id: string; successor_id: string }[])
      } else {
        toast.error((error as Error).message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Eliminar ${KIND_LABEL[item.kind].toLowerCase()}`} onClose={onClose}
      footer={conflict ? (
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn" disabled={busy} onClick={() => run('remove')}>Eliminar también las dependencias</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => run('bridge')}>Reconectar predecesoras → sucesoras</button>
        </>
      ) : (
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-danger" disabled={busy} onClick={() => run('reject')}>Eliminar</button>
        </>
      )}>
      {!conflict && (
        <p>
          ¿Eliminar <strong>{item.wbs_code} {item.name}</strong>
          {subtree.size > 1 && <> y sus <strong>{subtree.size - 1}</strong> elemento(s) contenidos</>}? Esta acción no se puede deshacer.
        </p>
      )}
      {conflict && (
        <>
          <p>La actividad tiene dependencias con otras actividades. ¿Cómo desea resolverlas?</p>
          <ul className="plain-list">
            {conflict.map((d, i) => (
              <li key={i}>{names.get(d.predecessor_id)} → {names.get(d.successor_id)}</li>
            ))}
          </ul>
          <p className="hint">“Reconectar” crea dependencias FS directas entre cada predecesora y cada sucesora para conservar la secuencia.</p>
        </>
      )}
    </Modal>
  )
}
