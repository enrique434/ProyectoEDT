import type { ReactNode } from 'react'
import { ToneIcon } from './icons'

interface AlertProps {
  tone: 'success' | 'error' | 'warning' | 'info'
  title?: string
  children?: ReactNode
  action?: ReactNode
  compact?: boolean
}

/** Inline, persistent message inside a page or form (as opposed to transient notifications). */
export function Alert({ tone, title, children, action, compact }: AlertProps) {
  return (
    <div className={`alert alert-${tone} ${compact ? 'alert-compact' : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      <ToneIcon tone={tone} size={compact ? 16 : 20} />
      <div className="alert-body">
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {action && <div className="alert-action">{action}</div>}
    </div>
  )
}
