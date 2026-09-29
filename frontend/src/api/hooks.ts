// React Query hooks. Every mutation returns the recalculated project, which replaces the cache.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { Created, Project } from './types'
import { useNotify } from '../components/feedback/Notifications'
import { MSG, type Notice } from '../lib/messages'

export const projectKey = (id: string) => ['project', id] as const

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: api.listProjects })
}

export function useProject(id: string) {
  return useQuery({ queryKey: projectKey(id), queryFn: () => api.getProject(id), retry: false })
}

function isCreated(value: Project | Created): value is Created {
  return 'project' in value && 'id' in value && !('items' in value)
}

export interface MutationFeedback<A> {
  /** Notice shown when the action succeeds. Receives the updated project and the action arguments. */
  success?: (project: Project, args: A, createdId?: string) => Notice | null
  /** What the user was doing, used as the title of the error notification. */
  error: string | ((args: A) => string)
}

/**
 * Every project change goes through here, so every action gives the same kind of feedback:
 *  - success notification (from the message catalog),
 *  - error notification with the action as title and the server's reason as message,
 *  - warning notification when the recalculated schedule has alerts that did not exist before.
 */
export function useProjectMutation<A>(
  projectId: string,
  call: (args: A) => Promise<Project | Created>,
  feedback: MutationFeedback<A>,
) {
  const client = useQueryClient()
  const notify = useNotify()
  return useMutation({
    mutationFn: call,
    onSuccess: (result, args) => {
      const project = isCreated(result) ? result.project : result
      const previous = client.getQueryData<Project>(projectKey(projectId))
      client.setQueryData(projectKey(projectId), project)
      client.invalidateQueries({ queryKey: ['projects'] })
      client.invalidateQueries({ queryKey: ['resource-load', projectId] })

      const notice = feedback.success?.(project, args, isCreated(result) ? result.id : undefined)
      if (notice) notify.success(notice)
      const before = new Set(previous?.schedule?.warnings ?? [])
      const added = (project.schedule?.warnings ?? []).filter((w) => !before.has(w))
      if (previous && added.length > 0) notify.warning(MSG.newWarnings(added))
    },
    onError: (error, args) => {
      notify.fromError(error, typeof feedback.error === 'function' ? feedback.error(args) : feedback.error)
    },
  })
}
