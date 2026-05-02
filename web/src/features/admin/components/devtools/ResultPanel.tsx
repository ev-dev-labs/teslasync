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
        <span className="text-xs font-medium text-white/70">{title}</span>
        {hasData ? <CopyButton text={stringifiedData} /> : null}
      </div>
      {error ? (
        <p className="text-sm text-rose-300">{error}</p>
      ) : hasData ? (
        <pre className="max-h-64 overflow-auto rounded bg-black/30 p-2 text-xs text-white/80">
          {stringifiedData}
        </pre>
      ) : (
        <p className="text-sm italic text-white/30">{idleMessage ?? 'No result yet'}</p>
      )}
    </div>
  )
}
