// Protects unsaved edits: closing a dialog, switching tabs, leaving a project or reloading the page
// asks for confirmation when some form is dirty.
import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, type MouseEvent, type ReactNode,
} from 'react'
import { Link, useNavigate, type LinkProps } from 'react-router-dom'
import { MSG } from '../../lib/messages'
import { useDialogs } from './Dialogs'

interface Guard {
  setDirty: (key: string, dirty: boolean) => void
  /** Resolves true when nothing is dirty or the user accepts to discard. */
  confirmLeave: () => Promise<boolean>
}

const GuardContext = createContext<Guard | null>(null)

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirtyKeys = useRef(new Set<string>())
  const { confirm } = useDialogs()

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyKeys.current.size > 0) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const setDirty = useCallback((key: string, dirty: boolean) => {
    if (dirty) dirtyKeys.current.add(key)
    else dirtyKeys.current.delete(key)
  }, [])

  const confirmLeave = useCallback(async () => {
    if (dirtyKeys.current.size === 0) return true
    const ok = await confirm({ ...MSG.discard, tone: 'warning' })
    if (ok) dirtyKeys.current.clear()
    return ok
  }, [confirm])

  const value = useMemo(() => ({ setDirty, confirmLeave }), [setDirty, confirmLeave])
  return <GuardContext.Provider value={value}>{children}</GuardContext.Provider>
}

function useGuard(): Guard {
  const context = useContext(GuardContext)
  if (!context) throw new Error('useGuard must be used inside <UnsavedChangesProvider>')
  return context
}

/** Registers a page-level form (calendar, settings) as dirty while it has unsaved changes. */
export function useUnsavedChanges(key: string, dirty: boolean): void {
  const { setDirty } = useGuard()
  useLayoutEffect(() => {
    setDirty(key, dirty)
    return () => setDirty(key, false)
  }, [key, dirty, setDirty])
}

/** Wraps a dialog's onClose: asks before discarding its unsaved changes. */
export function useGuardedClose(dirty: boolean, onClose: () => void): () => Promise<void> {
  const { confirm } = useDialogs()
  return useCallback(async () => {
    if (!dirty || await confirm({ ...MSG.discard, tone: 'warning' })) onClose()
  }, [dirty, onClose, confirm])
}

/** <Link> that respects unsaved changes in the current page. */
export function GuardedLink({ onClick, to, ...props }: LinkProps) {
  const { confirmLeave } = useGuard()
  const navigate = useNavigate()
  const handle = async (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    if (await confirmLeave()) navigate(to)
  }
  return <Link to={to} onClick={handle} {...props} />
}

export function useConfirmLeave(): () => Promise<boolean> {
  return useGuard().confirmLeave
}
