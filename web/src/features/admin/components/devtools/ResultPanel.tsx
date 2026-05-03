import { cn } from '@/lib/cn'
import { CopyButton } from '@/components/ui'

interface ResultPanelProps {
  title: string
  data?: unknown
  error?: string
  idle?: boolean
  idleMessage?: string
}

export function ResultPanel({ title, data, error, idleMessage }: ResultPanelProps) {
  const hasData = data != null
  const stringifiedData = hasData ? JSON.stringify(data, null, 2) : ''

  return (
    <div className={cn(
      'mt-3 rounded-lg p-3',
      error ? 'bg-neon-red/5' : hasData ? 'bg-neon-green/5' : 'bg-white/[0.02]',
    )}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--text-secondary)]">{title}</span>
        {hasData ? <CopyButton text={stringifiedData} /> : null}
      </div>
      {error ? (
        <p className="text-sm text-rose-300">{error}</p>
      ) : hasData ? (
        <pre className="max-h-64 overflow-auto rounded bg-[var(--surface-overlay)] p-2 text-xs text-[var(--text-primary)]">
          {stringifiedData}
        </pre>
      ) : (
        <p className="text-sm italic text-[var(--text-muted)]">{idleMessage ?? 'No result yet'}</p>
      )}
    </div>
  )
}
