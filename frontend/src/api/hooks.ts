// React Query hooks. Every mutation returns the recalculated project, which replaces the cache.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { Created, Project } from './types'
import { useToast } from '../components/Toast'

export const projectKey = (id: string) => ['project', id] as const

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: api.listProjects })
}

export function useProject(id: string) {
  return useQuery({ queryKey: projectKey(id), queryFn: () => api.getProject(id) })
}

function isCreated(value: Project | Created): value is Created {
  return 'project' in value && 'id' in value && !('items' in value)
}

/**
 * Wraps a call that returns the updated project (or {id, project}) and keeps the cache in sync.
 * Errors are shown as toasts unless the caller handles them with `onError`.
 */
export function useProjectMutation<A>(projectId: string, call: (args: A) => Promise<Project | Created>) {
  const client = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: call,
    onSuccess: (result) => {
      client.setQueryData(projectKey(projectId), isCreated(result) ? result.project : result)
      client.invalidateQueries({ queryKey: ['projects'] })
      client.invalidateQueries({ queryKey: ['resource-load', projectId] })
    },
    onError: (error: Error) => toast.error(error.message),
  })
}
