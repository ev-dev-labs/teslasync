import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Braces } from 'lucide-react'
import { Textarea, CopyButton } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import { ToolCard } from '../ToolCard'

/**
 * JsonFormatterTool — pastes arbitrary text and pretty-prints it as 2-space
 * indented JSON, or surfaces the parser error when the input is not valid JSON.
 *
 * The output area is a proper `empty | ok | error` state machine rather than a
 * pair of truthiness gates, so exactly one branch renders and the panel is
 * never blank (guideline #6). The input is labelled through the shared
 * `<Textarea label>` prop so it has an accessible name (the old standalone
 * `<span>` was not programmatically associated), the parse failure is exposed
 * as an `alert` for assistive tech, and the human-readable "Invalid JSON"
 * heading is translatable while the raw parser message is preserved beneath it
 * as a secondary detail line. Every visible string carries an English default
 * so a missing translation never leaks a raw key.
 */
type FormatResult =
  | { kind: 'empty' }
  | { kind: 'ok'; formatted: string }
  | { kind: 'error'; detail: string }

export function JsonFormatterTool() {
  const { t } = useTranslation()
  const [inputVal, setInputVal] = useState('')

  const result = useMemo<FormatResult>(() => {
    if (!inputVal.trim()) return { kind: 'empty' }
    try {
      const parsed = JSON.parse(inputVal) as unknown
      return { kind: 'ok', formatted: JSON.stringify(parsed, null, 2) }
    } catch (e) {
      return { kind: 'error', detail: e instanceof Error ? e.message : '' }
    }
  }, [inputVal])

  const formattedLabel = t('devtools.utils.jsonFormatted', 'Formatted')

  return (
    <ToolCard
      icon={Braces}
      color="green"
      title={t('devtools.utils.json', 'JSON Formatter')}
      description={t('devtools.utils.jsonDesc', 'Validate and pretty-print JSON with 2-space indentation.')}
    >
      <div className="space-y-3">
        <Textarea
          label={t('devtools.utils.jsonInput', 'JSON Input')}
          rows={4}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          placeholder='{"key":"value"}'
        />
        {result.kind === 'ok' ? (
          <div className="rounded bg-[var(--surface-overlay)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-secondary)]">{formattedLabel}</span>
              <CopyButton text={result.formatted} />
            </div>
            <pre className="mt-1 max-h-64 overflow-auto text-xs font-mono text-emerald-300">{result.formatted}</pre>
          </div>
        ) : result.kind === 'error' ? (
          <div role="alert" className="space-y-1">
            <p className="text-sm text-rose-300">{t('devtools.utils.jsonInvalid', 'Invalid JSON')}</p>
            {result.detail && <p className="text-xs text-[var(--text-muted)]">{result.detail}</p>}
          </div>
        ) : (
          <EmptyState
            message={t('devtools.utils.jsonEmpty', 'Paste JSON above to validate and pretty-print it.')}
            className="py-8"
          />
        )}
      </div>
    </ToolCard>
  )
}
