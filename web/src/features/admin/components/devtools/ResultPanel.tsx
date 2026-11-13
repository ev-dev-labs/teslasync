import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { CopyButton, Caption, ErrorText, HelperText, Text } from '@/components/ui'

interface ResultPanelProps {
  title: string
  data?: unknown
  error?: string
  idle?: boolean
  idleMessage?: string
  context?: string
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

export function ResultPanel({ title, data, error, idleMessage, context }: ResultPanelProps) {
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
      data-app-part={hasError ? 'feedback' : 'panel'}
      data-app-panel-kind={hasError ? undefined : 'code'}
      data-app-feedback-kind={hasError ? 'error' : undefined}
      data-app-tone={hasError ? 'danger' : undefined}
      data-app-state={hasError ? 'error' : hasData ? 'value' : 'idle'}
      className={cn(
        'mt-3 rounded-lg p-3',
        hasError ? 'bg-[var(--semantic-danger-bg)]' : 'bg-[var(--surface-2)]',
      )}
    >
      <div data-app-code-slot={hasError ? undefined : 'heading'} className="mb-1 flex items-center justify-between">
        <Caption data-app-part={hasError ? 'feedback-title' : undefined}>{title}</Caption>
        {showData ? <CopyButton text={stringifiedData} /> : null}
      </div>
      {context && (hasData || hasError) ? <HelperText data-app-code-slot={hasError ? undefined : 'context'} data-app-part={hasError ? 'feedback-detail' : undefined}>{context}</HelperText> : null}
      {hasError ? (
        <ErrorText data-app-part="feedback-message">
          {error}
        </ErrorText>
      ) : hasData ? (
        <Text data-app-part="panel" data-app-panel-kind="code" data-app-code-slot="body" as="pre" variant="code" className="max-h-64 overflow-auto rounded bg-[var(--surface-1)] p-2">
          {stringifiedData}
        </Text>
      ) : (
        <HelperText data-app-code-slot="context" className="italic">
          {idleMessage ?? t('devtools.resultPanel.noResult', 'No result yet')}
        </HelperText>
      )}
    </div>
  )
}
