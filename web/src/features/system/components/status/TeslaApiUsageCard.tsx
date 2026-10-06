import { useTranslation } from 'react-i18next'
import { UsageCard } from '@/components/data-display'
import type { APIUsage, TeslaUsageCycle } from '@/api/types'

import { useFormatting } from '@/hooks/useFormatting'
import { TeslaUsageContractError } from '@/api/hooks/useTeslaUsage'
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { SystemSummaryBrief } from '../operationalbrief-all/SystemSummaryBrief'

interface Props {
  apiUsage: APIUsage | undefined
  now: number
  loading?: boolean
  error?: Error | null
  compact?: boolean
}

export function TeslaApiUsageCard({ apiUsage, loading, error, compact = false }: Props) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation()
  const { formatCurrency } = useFormatting()
  const currentSource = apiUsage?.current
  const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { timeZone: 'UTC' })
  const disclaimer = t('teslaUsage.disclaimer', 'Estimate from locally observed Tesla Fleet traffic; not a Tesla invoice. Missing deliveries or logging failures may undercount.')
  const summary = (
    <SystemSummaryBrief
      title={t('teslaUsage.brief.cycleTitle', 'Cycle usage evidence')}
      description={disclaimer}
      scope={currentSource ? `${date(currentSource.start)} – ${date(currentSource.end)} UTC`
        : t('teslaUsage.cycleCaveat', 'These are fixed UTC 30-day windows, not Tesla calendar-month billing cycles. No monthly credit, rounding or invoice adjustments are assumed.')}
      available={!!currentSource} loading={!!loading && !currentSource} retained={!!error && !!currentSource}
      statusLabel={t('teslaUsage.estimated', 'Estimated')}
      metrics={[
        { metricId: 'currency', occurrenceId: 'estimate', rawValue: currentSource?.estimated_usd,
          label: t('teslaUsage.cycle', 'Current 30-day cycle'),
          context: t('teslaUsage.notInvoice', 'Local estimate, not an invoice'),
          display: { formatter: (raw) => ({ value: formatCurrency(raw) }) } },
        { metricId: 'count', occurrenceId: 'signals', rawValue: currentSource?.signals,
          label: t('teslaUsage.signals', 'Streaming signals'), context: t('teslaUsage.signalRate', '150,000 / $1') },
        { metricId: 'count', occurrenceId: 'api-calls', rawValue: currentSource
          ? currentSource.commands + currentSource.data_requests + currentSource.wakes : null,
          label: t('teslaUsage.events', 'Billable API calls'), context: currentSource
            ? `${fmtInt(currentSource.signals + currentSource.commands + currentSource.data_requests + currentSource.wakes)} ${t('teslaUsage.observedEvents', 'observed events')}` : disclaimer },
      ]}
    />
  )
  const pageLink = [{ key: 'usage', to: '/tesla-api-usage', label: t('teslaUsage.openPage', 'Explore Tesla API usage'), primary: true }]
  const compactState = (message: string) => (
    <>{summary}<UsageCard banner={{ title: message, description: t('teslaUsage.notInvoice', 'Local estimate, not an invoice'), intent: 'warn' }} footer={pageLink} /></>
  )
  const errorMessage = error instanceof TeslaUsageContractError
    ? t('teslaUsage.upgradeApi', 'Tesla usage requires a newer API service. Update the API service and refresh.')
    : t('teslaUsage.error', 'Tesla usage could not be loaded. Try refreshing.')
  if (compact && loading && !currentSource) return compactState(t('teslaUsage.loading', 'Loading Tesla usage…'))
  if (compact && error && !currentSource) return compactState(errorMessage)
  if (compact && !apiUsage) return compactState(t('teslaUsage.empty', 'Tesla usage is not available yet.'))
  if (loading && !apiUsage) return <>{summary}<UsageCard emptyMessage={t('teslaUsage.loading', 'Loading Tesla usage…')} /></>
  if (error && !apiUsage) return <>{summary}<UsageCard emptyMessage={errorMessage} /></>
  if (!apiUsage) return <>{summary}<UsageCard emptyMessage={t('teslaUsage.empty', 'Tesla usage is not available yet.')} /></>
  if (!apiUsage.current || !Array.isArray(apiUsage.history)) {
    const message = t('teslaUsage.upgradeApi', 'Tesla usage requires a newer API service. Update the API service and refresh.')
    return compact ? compactState(message) : <>{summary}<UsageCard emptyMessage={message} /></>
  }

  const count = (cycle: TeslaUsageCycle) =>
    cycle.signals + cycle.commands + cycle.data_requests + cycle.wakes
  const current = apiUsage.current
  if (compact) return (
    <>{summary}
    <UsageCard
      banner={{ title: t('teslaUsage.estimated', 'Estimated'),
        description: t('teslaUsage.disclaimer', 'Estimate from locally observed Tesla Fleet traffic; not a Tesla invoice. Missing deliveries or logging failures may undercount.'),
        intent: 'warn' }}
      footer={pageLink}
    />
    </>
  )
  return (
    <>{summary}
    <UsageCard
      details={[
        { label: t('teslaUsage.commands', 'Commands · 1,000 / $1'), value: fmtInt(current.commands) },
        { label: t('teslaUsage.data', 'Data requests · 500 / $1'), value: fmtInt(current.data_requests) },
        { label: t('teslaUsage.wakes', 'Wakes · 50 / $1'), value: fmtInt(current.wakes) },
        { label: t('teslaUsage.reset', 'Next cycle (UTC)'), value: date(current.end) },
      ]}
      topLists={[
        {
          key: 'history',
          title: t('teslaUsage.history', 'Prior 30-day cycles'),
          items: apiUsage.history.length
            ? apiUsage.history.map(c => ({
                key: c.start,
                label: `${date(c.start)} – ${date(c.end)} · ${fmtInt(count(c))} ${t('teslaUsage.eventsShort', 'events')}`,
                value: formatCurrency(c.estimated_usd),
              }))
            : [{ key: 'none', label: t('teslaUsage.noHistory', 'No prior cycles recorded'), value: '—' }],
        },
        {
          key: 'disclaimer',
          title: t('teslaUsage.source', 'Source and limitations'),
          items: [{
            key: 'estimate',
            label: t('teslaUsage.disclaimer', 'Estimate from locally observed Tesla Fleet traffic; not a Tesla invoice. Missing deliveries or logging failures may undercount.'),
            value: t('teslaUsage.estimated', 'Estimated'),
          }, {
            key: 'rates',
            label: t('teslaUsage.rateSource', 'Tesla Fleet API pricing reference'),
            value: apiUsage.rate_source,
          }],
        },
      ]}
      footer={[{ key: 'logs', to: '/api-logs', label: t('teslaUsage.logs', 'Open API logs') }]}
    />
    </>
  )
}
