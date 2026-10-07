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
import { Badge, Button, GlassPanel, PanelTitle, Caption, Text } from '@/components/ui'
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
  const tokensIn = formatCount(data?.input_tokens)
  const tokensOut = formatCount(data?.output_tokens)
  const costMicroCents = data?.cost_micro_cents
  const amount = typeof costMicroCents === 'number' && Number.isFinite(costMicroCents)
    ? costMicroCents / 1_000_000
    : null
  const cost = amount === null
    ? PLACEHOLDER
    : formatCurrency(amount, amount > 0 && amount < 0.01 ? 6 : 2)
  const loading = enabled && state.status === 'initial'
  const errors = data?.error_count === 1
    ? t('ai.settings.usage.errorOne', '1 error')
    : t('ai.settings.usage.errorMany', '{{total}} errors', { total: formatCount(data?.error_count) })

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
      <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-3">
        <UsageCell
          label={t('ai.settings.usage.tokensIn', 'Tokens in')}
          value={tokensIn}
          isLoading={loading}
        />
        <UsageCell
          label={t('ai.settings.usage.tokensOut', 'Tokens out')}
          value={tokensOut}
          isLoading={loading}
        />
        <UsageCell
          label={t('ai.settings.usage.cost', 'Estimated cost')}
          value={cost}
          isLoading={loading}
        />
      </div>
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

function UsageCell({
  label,
  value,
  isLoading,
}: {
  label: string
  value: string
  isLoading: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-shape-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
      <Caption>{label}</Caption>
      <Text
        as="span"
        variant="bodySm"
        className="break-words font-semibold tabular-nums"
        data-testid="ai-usage-value"
        aria-busy={isLoading || undefined}
      >
        {value}
      </Text>
    </div>
  )
}
