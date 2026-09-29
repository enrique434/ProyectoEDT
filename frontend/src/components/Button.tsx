import type { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger'
  size?: 'md' | 'sm'
  /** Shows a spinner, keeps the width and blocks repeated clicks while a request is running. */
  loading?: boolean
  loadingText?: string
}

export function Button({ variant = 'default', size = 'md', loading, loadingText, disabled, className = '', children, ...rest }: ButtonProps) {
  const classes = ['btn', variant !== 'default' && `btn-${variant}`, size === 'sm' && 'btn-sm', loading && 'is-loading', className]
  return (
    <button {...rest} className={classes.filter(Boolean).join(' ')} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading && <span className="spinner" aria-hidden="true" />}
      {loading && loadingText ? loadingText : children}
    </button>
  )
}
