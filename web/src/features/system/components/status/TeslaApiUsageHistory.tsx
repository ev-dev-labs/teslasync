import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TeslaUsageContractError, useTeslaUsageHistory } from '@/api/hooks/useTeslaUsage'
import type { TeslaUsageCycle, TeslaUsagePoint } from '@/api/types'
import { GlassPanel, Select } from '@/components/ui'
import { UsageCard } from '@/components/data-display'
import { StaleRefreshWarning } from '@/components/feedback'
import {
  BarChart, Bar, PieChart, Pie, Cell, ChartContainer, ChartLegend, ChartTooltip,
  ResponsiveContainer, XAxis, YAxis, Tooltip, chartGrid, axisTick, chartAnimationProps,
} from '@/components/charts'
import { useFormatting } from '@/hooks/useFormatting'
import { useDataState } from '@/hooks/useDataState'
import { useChartPalette } from '@/hooks/useChartPalette'
import { useDateFormat } from '@/hooks/useDateFormat'
import { useRangeState } from '@/hooks/useRangeState'
import { addCivilDays } from '@/lib/dateRange'

import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { SystemSummaryBrief } from '../operationalbrief-all/SystemSummaryBrief'

type Bucket = 'day' | 'week'

function categoryCost(point: TeslaUsagePoint | TeslaUsageCycle, category: 'signals' | 'commands' | 'data_requests' | 'wakes'): number {
  const size = { signals: 150000, commands: 1000, data_requests: 500, wakes: 50 }[category]
  return point[category] / size
}

export function TeslaApiUsageHistory() {
  const palette = useChartPalette()
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation()
  const { formatCurrency } = useFormatting()
  const { formatDate, formatDateRange } = useDateFormat()
  const formatCost = (value: unknown): string =>
    typeof value === 'number' && Number.isFinite(value) ? formatCurrency(value) : '—'
  const range = useRangeState()
  const [bucket, setBucket] = useState<Bucket>('day')
  const validRange = range.start <= range.end && range.end < addCivilDays(range.start, 366)
    && Date.parse(range.startInstant) < Date.parse(range.endInstantExclusive)
  const rangeLabel = formatDateRange(range.startInstant, range.endInstantExclusive)
  const query = useTeslaUsageHistory(
    range.startInstant, range.endInstantExclusive, bucket, validRange, range.timezone,
  )
  const { data, isLoading, error, refetch } = query
  const state = useDataState(query, { provenance: 'historical' })
  const loading = !state.hasData && !state.isRefreshBlocked && !state.fatalError &&
    (isLoading || (query.isPending && query.fetchStatus === 'fetching'))
  const unresolved = !state.hasData && !state.fatalError && !loading
  const unresolvedMessage = state.isRefreshBlocked
    ? t('dataState.status.paused', 'Refresh paused')
    : t('system.brief.unavailable', 'Source unavailable')
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
  const distribution = totals ? (['signals', 'commands', 'data_requests', 'wakes'] as const).map((key, index) => ({
    category: labels[key], usd: categoryCost(totals, key), color: palette[index],
  })) : []
  const invalid = !validRange ? t('teslaUsage.invalidRange', 'Select 1 to 366 calendar days, with the end on or after the start.') : null
  const showTotals = !!totals && !invalid
  const stateMessage = invalid ??
    (error instanceof TeslaUsageContractError
      ? t('teslaUsage.upgradeApi', 'Tesla usage requires a newer API service. Update the API service and refresh.')
      : error ? t('teslaUsage.historyError', 'Usage history could not be loaded. Try again.') :
      !state.hasData ? loading ? t('teslaUsage.historyLoading', 'Loading selected usage…') : unresolvedMessage :
      t('teslaUsage.historyEmpty', 'No observed Tesla billable traffic in this range. Try an older range.'))
  const emptyMessage = state.hasData && !invalid
    ? t('teslaUsage.historyEmpty', 'No observed Tesla billable traffic in this range. Try an older range.')
    : stateMessage

  return (
    <div className="space-y-4" aria-label={t('teslaUsage.historySection', 'Tesla usage history')}>
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label={t('teslaUsage.granularity', 'Group by')}
          value={bucket}
          onChange={e => setBucket(e.target.value as Bucket)}
          options={[
            { value: 'day', label: t('teslaUsage.daily', 'Daily') },
            { value: 'week', label: t('teslaUsage.weekly', 'Weekly (Monday start)') },
          ]}
          size="sm"
        />
      </div>
      {!invalid && <StaleRefreshWarning
        state={state}
        label={t('teslaUsage.historySection', 'Tesla usage history')}
        message={error ? stateMessage : undefined}
      />}
      <GlassPanel className="p-4 sm:p-6">
      <SystemSummaryBrief
        variant="embedded"
        title={t('teslaUsage.selectedEstimate', 'Selected range estimate')}
        description={t('teslaUsage.historyDisclaimer', 'Local observations only, not a Tesla invoice. Missing deliveries or audit logs can undercount; these selected-calendar windows are not Tesla calendar-month billing cycles.')}
        scope={rangeLabel}
        available={!!totals && !invalid} loading={loading && !invalid}
        retained={state.status === 'stale' && !!totals && !invalid}
        statusLabel={unresolved && !invalid ? unresolvedMessage : undefined}
        metrics={[
          { metricId: 'currency', occurrenceId: 'estimate', rawValue: invalid ? null : totals?.estimated_usd,
            label: t('teslaUsage.selectedEstimate', 'Selected range estimate'),
            context: state.hasData && !invalid
              ? t('teslaUsage.observedBuckets', '{{count}} observed buckets', {
                  count: points.length,
                  defaultValue_one: '{{count}} observed bucket',
                  defaultValue_other: '{{count}} observed buckets',
                })
              : stateMessage,
            display: { formatter: (raw) => ({ value: formatCurrency(raw), unit: '' }) } },
          { metricId: 'count', occurrenceId: 'signals', rawValue: invalid ? null : totals?.signals,
            label: labels.signals, context: totals ? formatCurrency(categoryCost(totals, 'signals')) : stateMessage },
          { metricId: 'count', occurrenceId: 'api-requests', rawValue: totals && !invalid ? totals.commands + totals.data_requests + totals.wakes : null,
            label: t('teslaUsage.historyRequests', 'Billable API requests'), context: t('teslaUsage.notInvoice', 'Local estimate, not an invoice') },
        ]}
      />
      <UsageCard
        emptyMessage={!showTotals ? stateMessage : undefined}
        details={showTotals && totals ? (['signals', 'commands', 'data_requests', 'wakes'] as const).map(key => ({
          label: labels[key],
          value: `${fmtInt(totals[key])} · ${formatCurrency(categoryCost(totals, key))}`,
        })) : undefined}
      />
      </GlassPanel>
      <ChartContainer
        title={t('teslaUsage.distributionTitle', 'Selected-range cost distribution')}
        subtitle={t('teslaUsage.distributionSubtitle', 'Estimated USD contribution by billable category. Counts and costs are listed above.')}
        ariaLabel={t('teslaUsage.distributionAria', 'Estimated cost share of streaming signals, commands, data requests and wakes in the selected range')}
        loading={loading && !invalid}
        error={invalid ?? state.fatalError}
        onRetry={() => { if (!invalid) void refetch() }}
        empty={!loading && !invalid && !state.fatalError && (!showTotals || !totals || totals.estimated_usd === 0)}
        emptyTitle={unresolved ? unresolvedMessage : undefined}
        emptyMessage={emptyMessage}
        emptyAction={unresolved ? { label: t('common.refresh', 'Refresh'), onClick: () => { void refetch() } } : undefined}
        data={distribution}
        dataColumns={[
          { key: 'category', label: t('teslaUsage.category', 'Billable category') },
          { key: 'usd', label: t('teslaUsage.estimatedUSD', 'Estimated USD'),
            format: formatCost },
        ]}
        metadata={{ rangeLabel, sourceLabel: t('teslaUsage.estimated', 'Estimated'), unitLabel: 'USD' }}
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
            <Tooltip content={<ChartTooltip valueFormatter={value => formatCurrency(Number(value))} />} />
            <ChartLegend />
          </PieChart>
        </ResponsiveContainer>
      </ChartContainer>
      <ChartContainer
        title={t('teslaUsage.trendTitle', 'Tesla usage cost over time')}
        subtitle={t('teslaUsage.trendSubtitle', 'Observed USD estimate per selected-calendar bucket; gaps are not filled with zeroes.')}
        ariaLabel={t('teslaUsage.trendAria', 'Stacked daily or weekly estimated Tesla usage cost for streaming signals, commands, data requests and wakes')}
        loading={loading && !invalid}
        error={invalid ?? state.fatalError}
        onRetry={() => { if (!invalid) void refetch() }}
        empty={!loading && !invalid && !state.fatalError && points.length === 0}
        emptyTitle={unresolved ? unresolvedMessage : undefined}
        emptyMessage={emptyMessage}
        emptyAction={unresolved ? { label: t('common.refresh', 'Refresh'), onClick: () => { void refetch() } } : undefined}
        chartKey="tesla-usage-history"
        metadata={{ rangeLabel, sourceLabel: t('teslaUsage.estimated', 'Estimated'), unitLabel: 'USD' }}
        data={chartRows}
        dataColumns={[
          { key: 'bucket_start', label: t('teslaUsage.bucketStart', 'Bucket start'),
            format: value => formatDate(typeof value === 'string' ? value : null) },
          ...(['signals', 'commands', 'data_requests', 'wakes'] as const).map(key => ({
            key, label: labels[key], format: formatCost,
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
              <XAxis dataKey="bucket_start" tick={axisTick} tickFormatter={value => formatDate(value)} />
              <YAxis tick={axisTick} width={62} tickFormatter={(value: number) => formatCurrency(value)} />
              <Tooltip content={<ChartTooltip valueFormatter={value => formatCurrency(Number(value))} />} />
              <ChartLegend />
              {(['signals', 'commands', 'data_requests', 'wakes'] as const).map((key, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  name={labels[key]}
                  stackId="cost"
                  fill={palette[index]}
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
