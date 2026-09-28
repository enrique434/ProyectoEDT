import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type ToastKind = 'error' | 'success' | 'info'
interface ToastMessage {
  id: number
  kind: ToastKind
  text: string
}

interface ToastApi {
  error: (text: string) => void
  success: (text: string) => void
  info: (text: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)
let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([])

  const dismiss = useCallback((id: number) => setMessages((all) => all.filter((m) => m.id !== id)), [])
  const push = useCallback(
    (kind: ToastKind, text: string) => {
      const id = nextId++
      setMessages((all) => [...all.slice(-3), { id, kind, text }])
      window.setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 3500)
    },
    [dismiss],
  )
  const api = useMemo<ToastApi>(
    () => ({
      error: (t) => push('error', t),
      success: (t) => push('success', t),
      info: (t) => push('info', t),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`toast toast-${m.kind}`} onClick={() => dismiss(m.id)}>
            {m.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside <ToastProvider>')
  return context
}
