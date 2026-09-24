import { Activity, Zap, Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { UsageCard } from '@/components/data-display'
import type { APIUsage, TeslaUsageCycle } from '@/api/types'
import { fmtInt } from '@/lib/numberFormat'
import { useFormatting } from '@/hooks/useFormatting'
import { TeslaUsageContractError } from '@/api/hooks/useTeslaUsage'

interface Props {
  apiUsage: APIUsage | undefined
  now: number
  loading?: boolean
  error?: Error | null
  compact?: boolean
}

export function TeslaApiUsageCard({ apiUsage, loading, error, compact = false }: Props) {
  const { t } = useTranslation()
  const { formatCurrency } = useFormatting()
  const pageLink = [{ key: 'usage', to: '/tesla-api-usage', label: t('teslaUsage.openPage', 'Explore Tesla API usage'), primary: true }]
  const compactState = (message: string) => (
    <UsageCard banner={{ title: message, description: t('teslaUsage.notInvoice', 'Local estimate, not an invoice'), intent: 'warn' }} footer={pageLink} />
  )
  const errorMessage = error instanceof TeslaUsageContractError
    ? t('teslaUsage.upgradeApi', 'Tesla usage requires a newer API service. Update the API service and refresh.')
    : t('teslaUsage.error', 'Tesla usage could not be loaded. Try refreshing.')
  if (compact && loading) return compactState(t('teslaUsage.loading', 'Loading Tesla usage…'))
  if (compact && error) return compactState(errorMessage)
  if (compact && !apiUsage) return compactState(t('teslaUsage.empty', 'Tesla usage is not available yet.'))
  if (loading) return <UsageCard emptyMessage={t('teslaUsage.loading', 'Loading Tesla usage…')} />
  if (error) return <UsageCard emptyMessage={errorMessage} />
  if (!apiUsage) return <UsageCard emptyMessage={t('teslaUsage.empty', 'Tesla usage is not available yet.')} />
  if (!apiUsage.current || !Array.isArray(apiUsage.history)) {
    const message = t('teslaUsage.upgradeApi', 'Tesla usage requires a newer API service. Update the API service and refresh.')
    return compact ? compactState(message) : <UsageCard emptyMessage={message} />
  }

  const count = (cycle: TeslaUsageCycle) =>
    cycle.signals + cycle.commands + cycle.data_requests + cycle.wakes
  const current = apiUsage.current
  const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { timeZone: 'UTC' })
  if (compact) return (
    <UsageCard
      bands={[
        { icon: <Activity className="h-3.5 w-3.5" />,
          label: t('teslaUsage.cycle', 'Current 30-day cycle'),
          value: formatCurrency(current.estimated_usd),
          sub: `${date(current.start)} – ${date(current.end)}` },
        { icon: <Zap className="h-3.5 w-3.5" />,
          label: t('teslaUsage.signals', 'Streaming signals'),
          value: fmtInt(current.signals) },
        { icon: <Clock className="h-3.5 w-3.5" />,
          label: t('teslaUsage.events', 'Billable API calls'),
          value: fmtInt(current.commands + current.data_requests + current.wakes) },
      ]}
      banner={{ title: t('teslaUsage.estimated', 'Estimated'),
        description: t('teslaUsage.disclaimer', 'Estimate from locally observed Tesla Fleet traffic; not a Tesla invoice. Missing deliveries or logging failures may undercount.'),
        intent: 'warn' }}
      footer={pageLink}
    />
  )
  return (
    <UsageCard
      bands={[
        {
          icon: <Activity className="h-3.5 w-3.5" />,
          label: t('teslaUsage.cycle', 'Current 30-day cycle'),
          value: formatCurrency(current.estimated_usd),
          sub: `${date(current.start)} – ${date(current.end)}`,
        },
        {
          icon: <Zap className="h-3.5 w-3.5" />,
          label: t('teslaUsage.signals', 'Streaming signals'),
          value: fmtInt(current.signals),
          sub: t('teslaUsage.signalRate', '150,000 / $1'),
        },
        {
          icon: <Clock className="h-3.5 w-3.5" />,
          label: t('teslaUsage.events', 'Billable API calls'),
          value: fmtInt(current.commands + current.data_requests + current.wakes),
          sub: `${fmtInt(count(current))} ${t('teslaUsage.observedEvents', 'observed events')}`,
        },
      ]}
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
  )
}
