// Icons shared by notifications, alerts, dialogs and field errors (one visual language).
export type Tone = 'success' | 'error' | 'warning' | 'info' | 'danger' | 'question'

const PATHS: Record<Tone, string> = {
  success: 'M9 12.5l2 2 4-4.5',
  error: 'M9.5 9.5l5 5m0-5l-5 5',
  danger: 'M9 8.5V7.5h6v1M8 9h8l-.7 8.2a1 1 0 0 1-1 .8H9.7a1 1 0 0 1-1-.8zM7 9h10',
  warning: 'M12 8v4.5m0 3v.01',
  info: 'M12 11v5m0-8v.01',
  question: 'M9.8 9.5a2.3 2.3 0 1 1 3.1 2.2c-.6.3-.9.8-.9 1.4v.4m0 2.5v.01',
}

export function ToneIcon({ tone, size = 20 }: { tone: Tone; size?: number }) {
  return (
    <svg className={`tone-icon tone-${tone}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {tone === 'warning'
        ? <path d="M12 3.5l9 16H3z" className="tone-shape" />
        : <circle cx="12" cy="12" r="9.5" className="tone-shape" />}
      <path d={PATHS[tone]} className="tone-mark" />
    </svg>
  )
}
