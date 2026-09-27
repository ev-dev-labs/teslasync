import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Button, Caption, GlassPanel, PanelTitle, Text } from '@/components/ui'
import { useAiUsageByFeature, useAiUsageRecent } from '@/api/hooks/useAiUsage'
import { useDataState } from '@/hooks/useDataState'
import { useFormatting } from '@/hooks/useFormatting'
import { fmtInt } from '@/lib/numberFormat'
import { AI_FEATURES, type AiFeatureId } from '@/ai/features'

interface Props {
  enabled: boolean
  capCents: number
}

export function AIFeatureSpendPanel({ enabled, capCents }: Props) {
  const { t, i18n } = useTranslation('settings')
  const { formatCurrency } = useFormatting()
  const breakdownQuery = useAiUsageByFeature(undefined, { enabled })
  const recentQuery = useAiUsageRecent(50, { enabled })
  const breakdown = useDataState(breakdownQuery, { provenance: 'historical' })
  const recent = useDataState(recentQuery, { provenance: 'historical' })
  const rows = useMemo(
    () => [...(enabled ? breakdown.data?.rows ?? [] : [])].sort(
      (a, b) => b.cost_micro_cents - a.cost_micro_cents || b.call_count - a.call_count,
    ),
    [breakdown.data, enabled],
  )
  const sampledCalls = useMemo(() => {
    const latest = new Map<string, { provider: string; model: string }>()
    if (!enabled) return latest
    for (const row of recent.data?.rows ?? []) {
      if (!latest.has(row.feature_id)) {
        latest.set(row.feature_id, { provider: row.provider, model: row.model })
      }
    }
    return latest
  }, [recent.data, enabled])

  const formatCost = (microCents: number) => {
    if (!Number.isFinite(microCents)) return '—'
    const dollars = microCents / 1_000_000
    return formatCurrency(dollars, dollars > 0 && dollars < 0.01 ? 6 : 2)
  }
  const formatLastCall = (timestamp: string) => {
    const date = new Date(timestamp)
    return Number.isNaN(date.getTime())
      ? '—'
      : new Intl.DateTimeFormat(i18n.language || 'en', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'UTC',
        }).format(date)
  }

  return (
    <GlassPanel className="space-y-4 p-4 sm:p-5" data-testid="ai-feature-spend-panel"
      aria-label={t('ai.settings.featureSpend.title', 'Spend by feature')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle>{t('ai.settings.featureSpend.title', 'Spend by feature')}</PanelTitle>
        <Badge variant={enabled && breakdown.status === 'stale' ? 'warning' : 'neutral'}>
          {t('ai.settings.featureSpend.window', 'Last 7 days · UTC')}
        </Badge>
      </div>
      <Text as="p" variant="bodySm">
        {capCents > 0
          ? t('ai.settings.featureSpend.globalCap', 'Audited estimated costs. The daily cap applies to all Helix calls combined, not to individual features.')
          : t('ai.settings.featureSpend.noCap', 'Audited estimated costs. No daily spend cap is set. Feature toggles control access, not individual spending limits.')}
      </Text>
      {!enabled ? (
        <Caption role="status">
          {t('ai.settings.featureSpend.off', 'Save an enabled Helix mode to inspect usage. No usage is requested while Helix is off.')}
        </Caption>
      ) : breakdown.status === 'initial' ? (
        <Caption role="status">{t('ai.settings.featureSpend.loading', 'Loading feature spend…')}</Caption>
      ) : breakdown.status === 'initialFailure' ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2">
          <Caption>{t('ai.settings.featureSpend.error', 'Feature spend could not be loaded.')}</Caption>
          <Button type="button" size="sm" variant="ghost" onClick={() => void breakdownQuery.refetch()}>
            {t('ai.settings.featureSpend.retry', 'Retry')}
          </Button>
        </div>
      ) : (
        <>
          {breakdown.status === 'stale' && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-2">
              <Caption>{t('ai.settings.featureSpend.stale', 'Showing retained spend; the latest refresh failed.')}</Caption>
              <Button type="button" size="sm" variant="ghost" onClick={() => void breakdownQuery.refetch()}>
                {t('ai.settings.featureSpend.retry', 'Retry')}
              </Button>
            </div>
          )}
          {rows.length === 0 ? (
            <Caption role="status">
              {t('ai.settings.featureSpend.empty', 'No audited Helix calls in the last 7 days.')}
            </Caption>
          ) : (
            <>
              <Caption>
                {t('ai.settings.featureSpend.attribution', 'Provider and model identify the latest call found in the 50 most recent calls, not a breakdown of the 7-day total.')}
              </Caption>
              {recent.status === 'initialFailure' || recent.status === 'stale' ? (
                <Caption role="status">
                  {t('ai.settings.featureSpend.recentUnavailable', 'Recent call attribution is unavailable or out of date. Spend totals remain available.')}
                </Caption>
              ) : null}
              <div className="space-y-2" role="list">
                {rows.map(row => {
                  const meta = AI_FEATURES[row.feature_id as AiFeatureId]
                  const name = meta
                    ? t(`ai.settings.feature.${row.feature_id}.label`, meta.name)
                    : row.feature_id
                  const sample = sampledCalls.get(row.feature_id)
                  return (
                    <div role="listitem" key={row.feature_id}
                      className="grid gap-2 rounded-shape-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="min-w-0">
                        <Text as="span" variant="bodySm" className="block font-medium">{name}</Text>
                        <Caption className="block">
                          {t('ai.settings.featureSpend.callsTokens', '{{calls}} calls · {{input}} in / {{output}} out · last call {{last}} UTC', {
                            calls: fmtInt(row.call_count),
                            input: fmtInt(row.input_tokens),
                            output: fmtInt(row.output_tokens),
                            last: formatLastCall(row.last_call_at),
                          })}
                        </Caption>
                        <Caption className="block">
                          {recent.status === 'initial'
                            ? t('ai.settings.featureSpend.sampleLoading', 'Loading recent call attribution…')
                            : sample && recent.status !== 'initialFailure'
                            ? t('ai.settings.featureSpend.sample', 'Recent call: {{provider}} / {{model}}', {
                                provider: sample.provider || '—',
                                model: sample.model || '—',
                              })
                            : t('ai.settings.featureSpend.noSample', 'No recent provider/model sample for this feature.')}
                        </Caption>
                      </div>
                      <Text as="span" variant="bodySm" className="font-semibold tabular-nums sm:text-right">
                        {formatCost(row.cost_micro_cents)}
                      </Text>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </GlassPanel>
  )
}
