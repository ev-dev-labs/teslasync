import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { CopyButton } from '@/components/ui'

interface ResultPanelProps {
  title: string
  data?: unknown
  error?: string
  idle?: boolean
  idleMessage?: string
}

/**
 * Serialise an arbitrary devtool payload for display without ever throwing.
 * `JSON.stringify` throws on circular references and returns `undefined` for
 * top-level functions/symbols — either of which would blank out or crash the
 * panel — so we always resolve to a printable string.
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

export function ResultPanel({ title, data, error, idleMessage }: ResultPanelProps) {
  const { t } = useTranslation()
  const hasData = data != null
  const hasError = Boolean(error)
  // Only offer to copy the payload we actually render — when an error is
  // present the JSON is hidden, so copying it would be a confusing no-op.
  const showData = hasData && !hasError

  const stringifiedData = useMemo(
    () => (data != null ? safeStringify(data) : ''),
    [data],
  )

  return (
    <div
      className={cn(
        'mt-3 rounded-lg p-3',
        hasError ? 'bg-neon-red/5' : hasData ? 'bg-neon-green/5' : 'bg-white/[0.02]',
      )}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--text-secondary)]">{title}</span>
        {showData ? <CopyButton text={stringifiedData} /> : null}
      </div>
      {hasError ? (
        <p role="alert" className="text-sm text-rose-300">
          {error}
        </p>
      ) : hasData ? (
        <pre className="max-h-64 overflow-auto rounded bg-[var(--surface-overlay)] p-2 text-xs text-[var(--text-primary)]">
          {stringifiedData}
        </pre>
      ) : (
        <p className="text-sm italic text-[var(--text-muted)]">
          {idleMessage ?? t('devtools.resultPanel.noResult', 'No result yet')}
        </p>
      )}
    </div>
  )
}
