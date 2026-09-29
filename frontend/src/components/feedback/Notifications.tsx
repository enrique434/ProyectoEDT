import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { describeError } from '../../lib/errors'
import type { Notice } from '../../lib/messages'
import { ToneIcon } from './icons'

export type NotificationTone = 'success' | 'error' | 'warning' | 'info'

export interface NotificationOptions extends Notice {
  action?: { label: string; onClick: () => void }
}

interface Notification extends NotificationOptions {
  id: number
  tone: NotificationTone
}

export interface Notifier {
  success: (notice: NotificationOptions) => void
  info: (notice: NotificationOptions) => void
  warning: (notice: NotificationOptions) => void
  error: (notice: NotificationOptions) => void
  /** Shows any thrown error with a consistent title/reason/details layout. */
  fromError: (error: unknown, context?: string) => void
}

// Errors and warnings stay longer: they usually require reading and acting.
const DURATION: Record<NotificationTone, number> = { success: 4000, info: 5000, warning: 9000, error: 12000 }
const MAX_VISIBLE = 4
const MAX_DETAILS = 6
const TONE_LABEL: Record<NotificationTone, string> = { success: 'Éxito', info: 'Información', warning: 'Advertencia', error: 'Error' }

const NotificationContext = createContext<Notifier | null>(null)
let nextId = 1

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Notification[]>([])

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((n) => n.id !== id)), [])
  const push = useCallback((tone: NotificationTone, notice: NotificationOptions) => {
    setItems((all) => {
      // Same message twice in a row (e.g. double click) is shown once.
      const duplicate = all.find((n) => n.tone === tone && n.title === notice.title && n.message === notice.message)
      const rest = duplicate ? all.filter((n) => n !== duplicate) : all
      return [...rest.slice(-(MAX_VISIBLE - 1)), { ...notice, tone, id: nextId++ }]
    })
  }, [])

  const notifier = useMemo<Notifier>(() => ({
    success: (n) => push('success', n),
    info: (n) => push('info', n),
    warning: (n) => push('warning', n),
    error: (n) => push('error', n),
    fromError: (error, context) => {
      const { title, message, details } = describeError(error, context)
      push('error', { title, message, details })
    },
  }), [push])

  return (
    <NotificationContext.Provider value={notifier}>
      {children}
      <section className="notifications" aria-label="Notificaciones">
        {items.map((n) => <NotificationCard key={n.id} notification={n} onDismiss={dismiss} />)}
      </section>
    </NotificationContext.Provider>
  )
}

function NotificationCard({ notification: n, onDismiss }: {
  notification: Notification
  onDismiss: (id: number) => void
}) {
  const [paused, setPaused] = useState(false)
  const remaining = useRef(DURATION[n.tone])
  const startedAt = useRef(0)
  const close = useCallback(() => onDismiss(n.id), [onDismiss, n.id])

  useEffect(() => {
    if (paused) return
    startedAt.current = Date.now()
    const timer = window.setTimeout(close, remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current -= Date.now() - startedAt.current
    }
  }, [paused, close])

  const details = n.details ?? []
  return (
    <div className={`notification notification-${n.tone}`} role={n.tone === 'error' ? 'alert' : 'status'}
      aria-live={n.tone === 'error' ? 'assertive' : 'polite'}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <ToneIcon tone={n.tone} />
      <div className="notification-body">
        <strong><span className="sr-only">{TONE_LABEL[n.tone]}: </span>{n.title}</strong>
        {n.message && <p>{n.message}</p>}
        {details.length > 0 && (
          <ul>
            {details.slice(0, MAX_DETAILS).map((d, i) => <li key={i}>{d}</li>)}
            {details.length > MAX_DETAILS && <li className="muted">y {details.length - MAX_DETAILS} más…</li>}
          </ul>
        )}
        {n.action && (
          <button className="notification-action" onClick={() => { n.action!.onClick(); close() }}>
            {n.action.label}
          </button>
        )}
      </div>
      <button className="icon-btn notification-close" onClick={close} aria-label="Cerrar notificación">✕</button>
      <span className="notification-timer"
        style={{ animationDuration: `${DURATION[n.tone]}ms`, animationPlayState: paused ? 'paused' : 'running' }} />
    </div>
  )
}

export function useNotify(): Notifier {
  const context = useContext(NotificationContext)
  if (!context) throw new Error('useNotify must be used inside <NotificationProvider>')
  return context
}
