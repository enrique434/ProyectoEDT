// Promise-based confirmation dialogs: `if (await dialogs.confirm({...})) { ... }`.
// Replaces the browser's confirm() with the application's own visual language.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Modal } from '../Modal'
import { ToneIcon } from './icons'

export type DialogTone = 'danger' | 'warning' | 'info' | 'question'

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  details?: string[]
  confirmLabel?: string
  cancelLabel?: string
  tone?: DialogTone
}

export interface Choice<T> {
  value: T
  label: string
  description?: string
  variant?: 'primary' | 'danger' | 'default'
}

export interface ChooseOptions<T> extends Omit<ConfirmOptions, 'confirmLabel'> {
  choices: Choice<T>[]
}

interface Dialogs {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  choose: <T>(options: ChooseOptions<T>) => Promise<T | null>
}

interface OpenDialog {
  options: ChooseOptions<unknown>
  resolve: (value: unknown) => void
}

const DialogContext = createContext<Dialogs | null>(null)
const CONFIRMED = Symbol('confirmed')

export function DialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<OpenDialog | null>(null)
  const resolved = useRef(false)

  const choose = useCallback(<T,>(options: ChooseOptions<T>) => new Promise<T | null>((resolve) => {
    resolved.current = false
    setOpen({ options: options as ChooseOptions<unknown>, resolve: resolve as (value: unknown) => void })
  }), [])

  const confirm = useCallback(async (options: ConfirmOptions) => {
    const tone = options.tone ?? 'question'
    const result = await choose({
      ...options,
      tone,
      choices: [{
        value: CONFIRMED,
        label: options.confirmLabel ?? 'Aceptar',
        variant: tone === 'danger' ? 'danger' : 'primary',
      }],
    })
    return result === CONFIRMED
  }, [choose])

  const finish = (value: unknown) => {
    if (!open || resolved.current) return
    resolved.current = true
    open.resolve(value)
    setOpen(null)
  }

  const api = useMemo(() => ({ confirm, choose }), [confirm, choose])
  const o = open?.options
  const tone = o?.tone ?? 'question'

  return (
    <DialogContext.Provider value={api}>
      {children}
      {o && (
        <Modal title={o.title} onClose={() => finish(null)} className={`dialog dialog-${tone}`}
          footer={
            <>
              {/* For destructive actions the safe option (cancel) receives the initial focus. */}
              <button className="btn" onClick={() => finish(null)} autoFocus={tone === 'danger'}>
                {o.cancelLabel ?? 'Cancelar'}
              </button>
              {o.choices.map((c, i) => (
                <button key={i} className={`btn ${c.variant === 'danger' ? 'btn-danger' : c.variant === 'default' ? '' : 'btn-primary'}`}
                  autoFocus={tone !== 'danger' && i === o.choices.length - 1} onClick={() => finish(c.value)}>
                  {c.label}
                </button>
              ))}
            </>
          }>
          <div className="dialog-content">
            <ToneIcon tone={tone} size={36} />
            <div>
              {o.message && <div className="dialog-message">{o.message}</div>}
              {o.details && o.details.length > 0 && (
                <ul className="dialog-details">{o.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
              )}
              {o.choices.some((c) => c.description) && (
                <dl className="dialog-choices">
                  {o.choices.filter((c) => c.description).map((c, i) => (
                    <div key={i}><dt>{c.label}</dt><dd>{c.description}</dd></div>
                  ))}
                </dl>
              )}
            </div>
          </div>
        </Modal>
      )}
    </DialogContext.Provider>
  )
}

export function useDialogs(): Dialogs {
  const context = useContext(DialogContext)
  if (!context) throw new Error('useDialogs must be used inside <DialogProvider>')
  return context
}
