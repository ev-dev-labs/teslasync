/**
 * Lightweight Helix usage card for Settings.
 *
 * Live "Usage today" card on the Helix settings panel. Reads the
 * `/ai/usage/today` endpoint via `useAiUsageToday()`
 * (TanStack Query, polled at INTERVALS.STANDARD) and renders the
 * three top-line metrics (tokens in, tokens out, estimated cost in
 * the user's locale currency).
 *
 * The "no per-feature toggle" rule is enforced server-side by
 * the `__usage__` meta-feature guard. The host skips this query
 * while AI is off so a disabled installation never polls a 404.
 *
 * The detailed operator-grade card (with feature breakdown, recent
 * calls, etc.) lives in `features/system/components/status/AiUsageCard`.
 * This Settings card is the lightweight "at a glance" surface — a
 * deeper drill-down already exists on the System status page.
 */

import { useTranslation } from 'react-i18next'
import { Badge, Button, GlassPanel, PanelTitle, Caption } from '@/components/ui'
import type { StatMetric } from '@/components/data-display'
import { SettingsSummaryBrief } from './operationalbrief-all/SettingsSummaryBrief'
import { useAiUsageToday } from '@/api/hooks/useAiUsage'
import { useDataState } from '@/hooks/useDataState'
import { useFormatting } from '@/hooks/useFormatting'
import { fmtInt } from '@/lib/numberFormat'

const PLACEHOLDER = '—'

function formatCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return PLACEHOLDER
  return fmtInt(n)
}

export function AIUsageCard({ enabled = true }: { enabled?: boolean }) {
  const { t } = useTranslation('settings')
  const { formatCurrency } = useFormatting()
  const query = useAiUsageToday({ enabled })
  const state = useDataState(query, { provenance: 'historical' })
  const data = enabled ? state.data : undefined
  const costMicroCents = data?.cost_micro_cents
  const amount = typeof costMicroCents === 'number'
    ? costMicroCents / 1_000_000
    : null
  const loading = enabled && state.status === 'initial'
  const errors = data?.error_count === 1
    ? t('ai.settings.usage.errorOne', '1 error')
    : t('ai.settings.usage.errorMany', '{{total}} errors', { total: formatCount(data?.error_count) })
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'helix-input-tokens', rawValue: data?.input_tokens,
      label: t('ai.settings.usage.tokensIn', 'Tokens in'),
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
    { metricId: 'count', occurrenceId: 'helix-output-tokens', rawValue: data?.output_tokens,
      label: t('ai.settings.usage.tokensOut', 'Tokens out'),
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
    { metricId: 'currency', occurrenceId: 'helix-estimated-cost', rawValue: amount,
      label: t('ai.settings.usage.cost', 'Estimated cost'),
      display: { formatter: raw => ({ value: formatCurrency(raw, raw > 0 && raw < 0.01 ? 6 : 2), unit: '' }) } },
  ]

  return (
    <GlassPanel
      className="space-y-4 p-4 sm:p-5"
      aria-label={t('ai.settings.usage.title', 'Usage today')}
      data-testid="ai-usage-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle>{t('ai.settings.usage.title', 'Usage today')}</PanelTitle>
        <Badge variant={state.status === 'stale' && enabled ? 'warning' : 'neutral'}>
          {t('ai.settings.usage.utc', 'Today · UTC')}
        </Badge>
      </div>
      <SettingsSummaryBrief title={t('ai.settings.usage.brief.title', 'Audited usage totals')}
        description={t('ai.settings.usage.brief.description', 'Input tokens, output tokens and estimated cost from the existing daily usage audit. Small non-zero costs retain six-decimal precision.')}
        source={t('ai.settings.usage.brief.source', 'Helix daily usage audit')}
        scope={t('ai.settings.usage.utc', 'Today · UTC')}
        metrics={metrics} loading={loading} unavailable={!data}
        retained={enabled && state.status === 'stale'} testId="helix-usage-summary" />
      {!enabled ? (
        <Caption className="block">
          {t('ai.settings.usage.off', 'Helix is off. Enable it and make a call to see usage.')}
        </Caption>
      ) : state.status === 'initialFailure' ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2">
          <Caption>{t('ai.settings.usage.error', 'Usage could not be loaded.')}</Caption>
          <Button type="button" size="sm" variant="ghost" onClick={() => void query.refetch()}>
            {t('ai.settings.usage.retry', 'Retry')}
          </Button>
        </div>
      ) : state.status === 'stale' ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2">
          <Caption>{t('ai.settings.usage.stale', 'Showing the last available totals. Refresh failed.')}</Caption>
          <Button type="button" size="sm" variant="ghost" onClick={() => void query.refetch()}>
            {t('ai.settings.usage.retry', 'Retry')}
          </Button>
        </div>
      ) : loading ? (
        <Caption className="block">{t('ai.settings.usage.loading', 'Loading today’s usage…')}</Caption>
      ) : data?.call_count === 0 ? (
        <Caption className="block">{t('ai.settings.usage.empty', 'No Helix calls yet today.')}</Caption>
      ) : data ? (
        <Caption className="block">
          {data.call_count === 1
            ? t('ai.settings.usage.summaryOne', '1 call · {{errors}}', {
                errors,
              })
            : t('ai.settings.usage.summary', '{{calls}} calls · {{errors}}', {
                calls: formatCount(data.call_count),
                errors,
              })}
        </Caption>
      ) : null}
    </GlassPanel>
  )
}
