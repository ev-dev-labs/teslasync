import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryWarning, BatteryMedium, ShieldCheck, AlertTriangle, Gauge } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, HelpTooltip, DataTable, type Column } from '@/components/ui';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip,
  BarChart, Bar, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useDrives } from '@/api/hooks/useDriving';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
import { chartTokens } from '@/lib/tokens';

import {
  summarizeRangeBuffer,
  LOW_ARRIVAL_PCT,
  CRITICAL_ARRIVAL_PCT,
  type CloseCall,
} from '../lib/rangeBuffer';

/** Bucket color: critical zone rose, low zone amber, everything else emerald. */
function bucketColor(fromPct: number): string {
  if (fromPct < CRITICAL_ARRIVAL_PCT) return chartTokens.series[3];
  if (fromPct < LOW_ARRIVAL_PCT) return chartTokens.series[2];
  return chartTokens.series[1];
}

export default function RangeBufferPage() {
  const { t } = useTranslation();
  usePageTitle(t('rangeBuffer.title', 'Range Buffer'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatDistance } = useUnits();

  const { start, end, setRange } = useRangeState({
    persistKey: 'range-buffer.range',
    defaultPresetId: 'all',
  });

  const drivesQuery = useDrives(vehicleIdStr, {
    start,
    end,
    limit: 1_000,
  });
  const drives = useMemo(
    () => drivesQuery.data ?? [],
    [drivesQuery.data],
  );

  const summary = useMemo(() => summarizeRangeBuffer(drives), [drives]);

  const histogramData = useMemo(
    () =>
      summary.buckets.map((b) => ({
        range: `${b.fromPct}–${b.toPct}%`,
        fromPct: b.fromPct,
        count: b.count,
      })),
    [summary.buckets],
  );

  const closeCallColumns = useMemo<Column<CloseCall>[]>(() => [
    {
      key: 'startTs',
      header: t('rangeBuffer.date', 'Date'),
      render: (r) => <Text variant="bodySm">{formatDateShort(r.startTs)}</Text>,
    },
    {
      key: 'distanceM',
      header: t('rangeBuffer.distance', 'Distance'),
      align: 'right',
      render: (r) => (
        <Text variant="body" className="font-mono tabular-nums">
          {formatDistance(r.distanceM, { precision: 1 })}
        </Text>
      ),
    },
    {
      key: 'arrivalPct',
      header: t('rangeBuffer.arrival', 'Arrival'),
      align: 'right',
      sortable: true,
      render: (r) => (
        <Text
          variant="body"
          className="font-mono font-semibold tabular-nums"
          style={{ color: bucketColor(r.arrivalPct) }}
        >
          {Math.round(r.arrivalPct)}%
        </Text>
      ),
    },
  ], [t, formatDistance]);

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('rangeBuffer.title', 'Range Buffer')} />;
  }

  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;

  return (
    <PageContainer
      title={t('rangeBuffer.title', 'Range Buffer')}
      subtitle={t('rangeBuffer.subtitle', 'How much battery is left when you arrive')}
      query={drivesQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="range-buffer-range"
          />
        </div>
      }
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('rangeBuffer.kpis', 'Range buffer summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('rangeBuffer.comfortScore', 'Comfort Score')}
                value={summary.comfortScore != null ? summary.comfortScore : '—'}
                subtitle={t('rangeBuffer.of100', 'of 100')}
                icon={<ShieldCheck className="h-5 w-5" />}
                color="green"
              />
              <MetricCard
                label={t('rangeBuffer.medianArrival', 'Median Arrival')}
                value={summary.medianArrivalPct != null ? `${summary.medianArrivalPct}%` : '—'}
                icon={<BatteryMedium className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('rangeBuffer.lowestArrival', 'Lowest Arrival')}
                value={summary.lowestArrivalPct != null ? `${Math.round(summary.lowestArrivalPct)}%` : '—'}
                icon={<BatteryWarning className="h-5 w-5" />}
                color="amber"
              />
              <MetricCard
                label={t('rangeBuffer.lowArrivals', 'Low Arrivals')}
                value={summary.lowCount}
                subtitle={t('rangeBuffer.belowPct', 'below {{pct}}%', { pct: LOW_ARRIVAL_PCT })}
                icon={<AlertTriangle className="h-5 w-5" />}
                color="red"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Histogram + monthly trend */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ChartContainer
            title={t('rangeBuffer.histogram', 'Arrival Battery Distribution')}
            ariaLabel={t('rangeBuffer.histogram.aria', 'Histogram of arrival battery percentage across drives')}
            loading={isLoading}
            empty={summary.analyzed === 0}
            height={280}
            data={histogramData}
            dataColumns={[
              { key: 'range', label: t('rangeBuffer.col.range', 'Arrival range') },
              { key: 'count', label: t('rangeBuffer.col.drives', 'Drives') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={histogramData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="range" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval={0} />
                <YAxis allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name={t('rangeBuffer.drives', 'Drives')} radius={[4, 4, 0, 0]}>
                  {histogramData.map((b) => (
                    <Cell key={b.range} fill={bucketColor(b.fromPct)} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>

          <ChartContainer
            title={t('rangeBuffer.trend', 'Monthly Median Arrival')}
            ariaLabel={t('rangeBuffer.trend.aria', 'Monthly median arrival battery percentage line chart')}
            loading={isLoading}
            empty={summary.monthlyMedian.length < 2}
            height={280}
            data={summary.monthlyMedian}
            dataColumns={[
              { key: 'month', label: t('rangeBuffer.col.month', 'Month') },
              { key: 'medianPct', label: t('rangeBuffer.col.median', 'Median arrival %') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={summary.monthlyMedian}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="monotone"
                  dataKey="medianPct"
                  name={t('rangeBuffer.medianArrival', 'Median Arrival')}
                  stroke={chartTokens.series[5]}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        </section>
      </FadeIn>

      {/* 3 — Close calls */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('rangeBuffer.closeCalls', 'Closest Calls')}
            <HelpTooltip
              size="sm"
              i18nKey="help.rangeBuffer.body"
              defaultValue="The five drives that ended with the least battery remaining. Regularly arriving below 20% adds thermal and cycling stress near the bottom of the pack — a healthy buffer keeps the score high."
              ariaLabel={t('help.rangeBuffer.iconLabel', 'More info about range buffer')}
            />
          </PanelTitle>
          {isError ? (
            <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
          ) : isLoading ? (
            <Skeleton height={180} />
          ) : summary.closeCalls.length === 0 ? (
            <EmptyState /* no-action: appears only when the period has no analyzable drives; the range picker above is the recovery surface. */
              icon={<BatteryMedium className="h-8 w-8" />}
              message={t('rangeBuffer.noData', 'No drives with arrival battery data in this period.')}
            />
          ) : (
            <DataTable
              tableId="driving:range-buffer-close-calls"
              columns={closeCallColumns}
              data={summary.closeCalls}
              keyExtractor={(r) => r.driveId}
              emptyMessage={t('rangeBuffer.noData', 'No drives with arrival battery data in this period.')}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
