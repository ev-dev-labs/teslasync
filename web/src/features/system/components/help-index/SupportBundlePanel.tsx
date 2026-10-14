import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, ShieldCheck } from 'lucide-react'

import { Button, CopyButton, GlassPanel, PanelTitle, Text } from '@/components/ui'
import { Skeleton } from '@/components/feedback'
import { useSupportBundle } from '@/api/hooks/useSupport'
import { useDateFormat } from '@/hooks/useDateFormat'
import { ProblemReportModal } from '@/components/feedback/ProblemReportModal'
import { SystemSummaryBrief } from '../operationalbrief-all/SystemSummaryBrief'

/**
 * Support bundle + problem report entry point (HELP-08, HELP-09).
 *
 * The bundle is shown in full before it is copied or downloaded. That is the
 * point: a user asked to send diagnostics to a stranger deserves to read
 * exactly what they are sending, and a reviewer auditing our privacy claims
 * can verify them from the UI rather than from this comment.
 *
 * The "what is never included" list is rendered as prominently as the bundle
 * itself, because the question people actually have is not "what is in it" but
 * "is my VIN in it".
 */
const NEVER_INCLUDED: ReadonlyArray<{ key: string; fallback: string }> = [
  { key: 'supportBundle.never.vin', fallback: 'Vehicle identification numbers' },
  { key: 'supportBundle.never.location', fallback: 'Locations or coordinates' },
  { key: 'supportBundle.never.tokens', fallback: 'Tokens, keys and credentials' },
  { key: 'supportBundle.never.email', fallback: 'E-mail addresses and account names' },
  { key: 'supportBundle.never.logs', fallback: 'Raw console or server logs' },
]

export function SupportBundlePanel() {
  const { t } = useTranslation()
  const { bundle, json, sources, download } = useSupportBundle()
  const { formatDateTime } = useDateFormat()
  const [reportOpen, setReportOpen] = useState(false)
  const sourceRows = [
    { key: 'version', label: t('supportBundle.field.version', 'App version'), value: bundle.app.version, state: sources.version },
    { key: 'health', label: t('supportBundle.field.health', 'Health'), value: bundle.health.overall, state: sources.health },
  ]

  return (
    <GlassPanel className="p-4 sm:p-5" data-testid="support-bundle-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PanelTitle>{t('supportBundle.title', 'Support bundle')}</PanelTitle>
          <Text as="p" variant="bodySm" className="mt-1 max-w-2xl">
            {t(
              'supportBundle.subtitle',
              'A redacted technical summary of this browser session. Copy or download it to attach to a support conversation.',
            )}
          </Text>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <CopyButton
            text={json}
            variant="secondary"
            label={t('supportBundle.copy', 'Copy bundle')}
            className="max-md:min-h-11 max-md:min-w-11"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={download}
            wrapLabel
            className="max-md:min-h-11 max-md:min-w-11"
            data-testid="support-bundle-download"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t('supportBundle.download', 'Download')}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => setReportOpen(true)}
            wrapLabel
            className="max-md:min-h-11 max-md:min-w-11"
            data-testid="open-problem-report"
          >
            {t('supportBundle.reportProblem', 'Report a problem')}
          </Button>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/5 p-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden />
        <div className="min-w-0">
          <Text as="p" size="sm" weight="medium" color="primary">
            {t('supportBundle.neverTitle', 'Never included')}
          </Text>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5" data-testid="support-bundle-never">
            {NEVER_INCLUDED.map((item) => (
              <li key={item.key}>
                <Text as="span" variant="bodySm" color="muted">
                  {t(item.key, item.fallback)}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4">
        <SystemSummaryBrief
          title={t('supportBundle.title', 'Support bundle')}
          description={t('supportBundle.subtitle', 'A redacted technical summary of this browser session. Copy or download it to attach to a support conversation.')}
          scope={t('supportBundle.brief.scope', 'Current browser-session bundle; exact redacted contents remain available below.')}
          available
          statusLabel={t('supportBundle.field.browser', 'Browser')}
          metrics={[{ metricId: 'count', occurrenceId: 'errors', rawValue: bundle.errors.length,
            label: t('supportBundle.field.errors', 'Recent errors') }]}
          textMetrics={[
            { key: 'browser', label: t('supportBundle.field.browser', 'Browser'), value: `${bundle.browser.family} ${bundle.browser.major_version}`.trim() || '—', detail: t('supportBundle.brief.metadata', 'Redacted browser-session bundle metadata.') },
          ]}
        />
      </div>

      <Text as="p" variant="bodySm" color="secondary" className="mt-4">
        {t('dataSources.partialMessage', 'Available sections remain visible. Source status is tracked independently below.')}
      </Text>
      <div className="mt-3 grid min-w-0 gap-4 md:grid-cols-2">
        {sourceRows.map(({ key, label, value, state }) => {
          const known = state.hasData && value !== '' && value !== 'unknown'
          const status = state.fatalError
            ? t('dataSources.status.failed', 'Failed')
            : state.refreshError
              ? t('dataSources.status.refreshFailed', 'Cached · refresh failed')
              : state.isRefreshBlocked
                ? t('dataSources.status.paused', 'Refresh paused')
                : state.isLoading && !state.hasData
                  ? t('dataSources.status.loading', 'Loading')
                  : state.isPending
                    ? t('dataSources.status.pending', 'Pending')
                    : !known
                      ? t('common.unknown', 'Unknown')
                      : state.status === 'stale'
                        ? t('system.brief.retained', 'Retained source')
                        : t('system.brief.available', 'Source available')
          return (
            <section key={key} aria-labelledby={`support-source-${key}`}
              className="min-w-0 space-y-2 break-words" data-testid={`support-source-${key}`}>
              <Text as="h3" id={`support-source-${key}`} variant="bodySm" weight="medium">
                {label}
              </Text>
              <Text as="p" variant="bodySm" color="secondary" role="status">
                {status}
              </Text>
              {state.isRefreshBlocked && (state.fatalError || state.refreshError) && (
                <Text as="p" variant="bodySm" color="secondary">
                  {t('dataSources.status.paused', 'Refresh paused')}
                </Text>
              )}
              {state.isLoading && !state.hasData && !state.isRefreshBlocked
                ? <Skeleton className="h-6 w-2/3" />
                : <Text as="p" variant="bodySm">{known ? value : t('common.unknown', 'Unknown')}</Text>}
              {state.hasData && (state.status === 'stale' || state.isRefreshing) && (
                <Text as="p" variant="bodySm" color="secondary">
                  {t('dataSources.staleMessage', 'Previously loaded data remains visible while affected sources recover.')}
                </Text>
              )}
              {state.isRefreshing && (
                <Text as="p" variant="bodySm" color="secondary">
                  {t('dataSources.status.refreshing', 'Refreshing')}
                </Text>
              )}
              <Text as="p" variant="bodySm" color="muted">
                {t('system.brief.freshnessUnknown', 'Source observation time not supplied')}
              </Text>
              {state.updatedAt != null && (
                <Text as="p" variant="bodySm" color="muted">
                  {t('supportBundle.source.receivedAt', 'Last successful response: {{time}}', {
                    time: formatDateTime(new Date(state.updatedAt)),
                  })}
                </Text>
              )}
              {state.retry && (state.fatalError || state.status === 'stale' || state.isRefreshBlocked || state.isPending) && (
                <Button type="button" variant="secondary" size="sm" wrapLabel
                  className="max-md:min-h-11 max-md:min-w-11"
                  disabled={state.isRefreshing || state.isLoading}
                  onClick={state.retry}
                  aria-label={t('supportBundle.source.retry', 'Retry {{source}}', { source: label })}>
                  {t('error.retry', 'Retry')}
                </Button>
              )}
            </section>
          )
        })}
      </div>

      <details className="mt-4">
        <summary className="flex cursor-pointer items-center max-md:min-h-11 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
          {t('supportBundle.showJson', 'Show the exact bundle contents')}
        </summary>
        <pre
          data-testid="support-bundle-json"
          className="mt-2 max-h-80 overflow-auto rounded-md bg-[var(--surface-2)] p-2 text-2xs text-[var(--text-secondary)]"
        >
          {json}
        </pre>
      </details>

      {/* Mounted only while open. The modal owns mutation + toast hooks, and
          mounting it eagerly would make the whole Help page depend on a
          ToastProvider it does not otherwise need — and would pay for those
          hooks on every render of a panel the user has not opened. */}
      {reportOpen && <ProblemReportModal open onClose={() => setReportOpen(false)} />}
    </GlassPanel>
  )
}
