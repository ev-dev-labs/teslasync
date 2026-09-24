import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TeslaUsageContractError, useTeslaUsageHistory } from '@/api/hooks/useTeslaUsage'
import type { TeslaUsageCycle, TeslaUsagePoint } from '@/api/types'
import { RangePicker } from '@/components/forms'
import { GlassPanel, Select, Text } from '@/components/ui'
import { UsageCard } from '@/components/data-display'
import {
  BarChart, Bar, PieChart, Pie, Cell, ChartContainer, ChartLegend, ChartTooltip, CHART_COLORS,
  ResponsiveContainer, XAxis, YAxis, Tooltip, chartGrid, axisTick, chartAnimationProps,
} from '@/components/charts'
import { useFormatting } from '@/hooks/useFormatting'
import { fmtInt } from '@/lib/numberFormat'

const DAY_MS = 86_400_000
type Bucket = 'day' | 'week'
type Range = { start: string; end: string }

function utcDay(date: Date): string { return date.toISOString().slice(0, 10) }

function initialRange(): Range {
  const today = new Date(`${utcDay(new Date())}T00:00:00Z`)
  return { start: utcDay(new Date(today.getTime() - 29 * DAY_MS)), end: utcDay(today) }
}

// Shared RangePicker uses inclusive civil dates. The API uses UTC [start,end).
export function toUtcUsageRange(range: Range): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.start) || !/^\d{4}-\d{2}-\d{2}$/.test(range.end)) return null
  const start = Date.parse(`${range.start}T00:00:00Z`)
  const lastDay = Date.parse(`${range.end}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(lastDay) ||
    utcDay(new Date(start)) !== range.start || utcDay(new Date(lastDay)) !== range.end ||
    lastDay < start || lastDay + DAY_MS - start > 366 * DAY_MS) return null
  return { start: new Date(start).toISOString(), end: new Date(lastDay + DAY_MS).toISOString() }
}

function categoryCost(point: TeslaUsagePoint | TeslaUsageCycle, category: 'signals' | 'commands' | 'data_requests' | 'wakes'): number {
  const size = { signals: 150000, commands: 1000, data_requests: 500, wakes: 50 }[category]
  return point[category] / size
}

export function TeslaApiUsageHistory() {
  const { t } = useTranslation()
  const { formatCurrency } = useFormatting()
  const [range, setRange] = useState<Range>(initialRange)
  const [bucket, setBucket] = useState<Bucket>('day')
  const utcRange = toUtcUsageRange(range)
  const { data, isLoading, error, refetch } = useTeslaUsageHistory(
    utcRange?.start ?? '', utcRange?.end ?? '', bucket, !!utcRange,
  )
  const totals = data?.total
  const points = data?.points ?? []
  const chartRows = points.map(point => ({
    bucket_start: point.bucket_start,
    signals: categoryCost(point, 'signals'),
    commands: categoryCost(point, 'commands'),
    data_requests: categoryCost(point, 'data_requests'),
    wakes: categoryCost(point, 'wakes'),
  }))
  const labels = {
    signals: t('teslaUsage.signals', 'Streaming signals'),
    commands: t('teslaUsage.historyCommands', 'Commands'),
    data_requests: t('teslaUsage.historyData', 'Data requests'),
    wakes: t('teslaUsage.historyWakes', 'Wakes'),
  }
  const distribution = (['signals', 'commands', 'data_requests', 'wakes'] as const).map((key, index) => ({
    category: labels[key], usd: totals ? categoryCost(totals, key) : 0, color: CHART_COLORS[index],
  }))
  const invalid = !utcRange ? t('teslaUsage.invalidRange', 'Select 1 to 366 UTC days, with the end on or after the start.') : null
  const showTotals = !!totals && points.length > 0 && !isLoading && !error && !invalid
  const stateMessage = invalid ??
    (error instanceof TeslaUsageContractError
      ? t('teslaUsage.upgradeApi', 'Tesla usage requires a newer API service. Update the API service and refresh.')
      : error ? t('teslaUsage.historyError', 'Usage history could not be loaded. Try again.') :
      t('teslaUsage.historyEmpty', 'No observed Tesla billable traffic in this range. Try an older range.'))

  return (
    <div className="space-y-4" aria-label={t('teslaUsage.historySection', 'Tesla usage history')}>
      <Text as="p" variant="caption" className="text-muted-foreground">
        {t('teslaUsage.historyDisclaimer', 'Local observations only, not a Tesla invoice. Missing deliveries or audit logs can undercount; these UTC windows are not Tesla calendar-month billing cycles.')}
      </Text>
      <div className="flex flex-wrap items-end gap-3">
        <RangePicker
          value={range}
          onChange={next => setRange(next)}
          presetIds={['7d', '30d', '90d', '1y']}
          minDate="2015-01-01"
          maxDate={utcDay(new Date())}
          timezone="UTC"
          scope="local"
        />
        <Select
          label={t('teslaUsage.granularity', 'Group by')}
          value={bucket}
          onChange={e => setBucket(e.target.value as Bucket)}
          options={[
            { value: 'day', label: t('teslaUsage.daily', 'Daily (UTC)') },
            { value: 'week', label: t('teslaUsage.weekly', 'Weekly (UTC, Monday start)') },
          ]}
          size="sm"
        />
      </div>
      <GlassPanel className="p-4 sm:p-6">
      <UsageCard
        emptyMessage={!showTotals
          ? isLoading && !invalid ? t('teslaUsage.historyLoading', 'Loading selected usage…') : stateMessage
          : undefined}
        bands={showTotals && totals ? [
          { label: t('teslaUsage.selectedEstimate', 'Selected range estimate'), value: formatCurrency(totals.estimated_usd, 4),
            sub: t('teslaUsage.observedBuckets', '{{count}} observed buckets', { count: points.length }) },
          { label: labels.signals, value: fmtInt(totals.signals), sub: formatCurrency(categoryCost(totals, 'signals'), 4) },
          { label: t('teslaUsage.historyRequests', 'Billable API requests'),
            value: fmtInt(totals.commands + totals.data_requests + totals.wakes),
            sub: t('teslaUsage.notInvoice', 'Local estimate, not an invoice') },
        ] : undefined}
        details={showTotals && totals ? (['signals', 'commands', 'data_requests', 'wakes'] as const).map(key => ({
          label: labels[key],
          value: `${fmtInt(totals[key])} · ${formatCurrency(categoryCost(totals, key), 4)}`,
        })) : undefined}
      />
      </GlassPanel>
      <ChartContainer
        title={t('teslaUsage.distributionTitle', 'Selected-range cost distribution')}
        subtitle={t('teslaUsage.distributionSubtitle', 'Estimated USD contribution by billable category. Counts and costs are listed above.')}
        ariaLabel={t('teslaUsage.distributionAria', 'Estimated cost share of streaming signals, commands, data requests and wakes in the selected range')}
        loading={isLoading && !invalid}
        error={invalid ?? error}
        onRetry={() => { if (!invalid) void refetch() }}
        empty={!isLoading && !invalid && !error && (!showTotals || !totals || totals.estimated_usd === 0)}
        emptyMessage={stateMessage}
        data={distribution}
        dataColumns={[
          { key: 'category', label: t('teslaUsage.category', 'Billable category') },
          { key: 'usd', label: t('teslaUsage.estimatedUSD', 'Estimated USD'),
            format: (value: unknown) => formatCurrency(typeof value === 'number' ? value : 0, 4) },
        ]}
        metadata={{ rangeLabel: `${range.start} – ${range.end} UTC`, sourceLabel: t('teslaUsage.estimated', 'Estimated'), unitLabel: 'USD' }}
        exportable
        exportFilename="tesla-usage-distribution"
        exportData={distribution}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={distribution.filter(row => row.usd > 0)} dataKey="usd" nameKey="category"
              cx="50%" cy="50%" innerRadius="45%" outerRadius="72%" isAnimationActive={false}>
              {distribution.filter(row => row.usd > 0).map(row => <Cell key={row.category} fill={row.color} />)}
            </Pie>
            <Tooltip content={<ChartTooltip valueFormatter={value => formatCurrency(Number(value), 4)} />} />
            <ChartLegend />
          </PieChart>
        </ResponsiveContainer>
      </ChartContainer>
      <ChartContainer
        title={t('teslaUsage.trendTitle', 'Tesla usage cost over time')}
        subtitle={t('teslaUsage.trendSubtitle', 'Observed USD estimate per UTC bucket; gaps are not filled with zeroes.')}
        ariaLabel={t('teslaUsage.trendAria', 'Stacked daily or weekly estimated Tesla usage cost for streaming signals, commands, data requests and wakes')}
        loading={isLoading && !invalid}
        error={invalid ?? error}
        onRetry={() => { if (!invalid) void refetch() }}
        empty={!isLoading && !invalid && !error && points.length === 0}
        emptyMessage={stateMessage}
        chartKey="tesla-usage-history"
        metadata={{ rangeLabel: `${range.start} – ${range.end} UTC`, sourceLabel: t('teslaUsage.estimated', 'Estimated'), unitLabel: 'USD' }}
        data={chartRows}
        dataColumns={[
          { key: 'bucket_start', label: t('teslaUsage.bucketStart', 'UTC bucket start') },
          ...(['signals', 'commands', 'data_requests', 'wakes'] as const).map(key => ({
            key, label: labels[key], format: (value: unknown) => formatCurrency(typeof value === 'number' ? value : 0, 4),
          })),
        ]}
        exportable
        exportFilename="tesla-usage-history"
        exportData={chartRows}
      >
        {({ hiddenSeries }) => (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartRows} margin={{ top: 12, right: 8, bottom: 4, left: 0 }}>
              {chartGrid}
              <XAxis dataKey="bucket_start" tick={axisTick} tickFormatter={value => String(value).slice(5, 10)} />
              <YAxis tick={axisTick} width={62} tickFormatter={(value: number) => formatCurrency(value, 2)} />
              <Tooltip content={<ChartTooltip timezone="UTC" valueFormatter={value => formatCurrency(Number(value), 4)} />} />
              <ChartLegend />
              {(['signals', 'commands', 'data_requests', 'wakes'] as const).map((key, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  name={labels[key]}
                  stackId="cost"
                  fill={CHART_COLORS[index]}
                  hide={hiddenSeries?.isHidden(key)}
                  {...chartAnimationProps()}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartContainer>
    </div>
  )
}
