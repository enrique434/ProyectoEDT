import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  className?: string
}

// Open modals, bottom to top. Only the top one reacts to Escape (e.g. a confirmation over an editor).
const stack: string[] = []

export function Modal({ title, onClose, children, footer, wide, className = '' }: ModalProps) {
  const id = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  // Layout effect: the Escape handler must see the latest onClose (e.g. one that now guards unsaved edits)
  // even when the key is pressed right after an edit, before the browser paints.
  useLayoutEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    stack.push(id)
    const dialog = dialogRef.current
    if (dialog && !dialog.contains(document.activeElement)) {
      const target = dialog.querySelector<HTMLElement>('[autofocus], input, select, textarea, .modal-footer button')
      target?.focus()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === id) {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      stack.splice(stack.indexOf(id), 1)
      previousFocus?.focus?.()
    }
  }, [id])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} className={`modal ${wide ? 'modal-wide' : ''} ${className}`} role="dialog" aria-modal="true"
        aria-labelledby={`${id}-title`}>
        <header className="modal-header">
          <h2 id={`${id}-title`}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  )
}
