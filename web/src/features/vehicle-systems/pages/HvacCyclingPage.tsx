import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock3, Fan, Gauge, RotateCw, TimerReset } from 'lucide-react';

import { useClimateHistory } from '@/api/hooks/useVehicleSystems';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from '@/components/charts';
import { MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';

import { summarizeHvacCycling } from '../lib/hvacCycling';

export default function HvacCyclingPage() {
  const { t } = useTranslation();
  usePageTitle(t('hvacCycling.title', 'HVAC Cycling'));
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : '';
  const { formatDuration } = useUnits();
  const climateQuery = useClimateHistory(vehicleIdStr);
  const summary = useMemo(
    () => summarizeHvacCycling(climateQuery.data ?? []),
    [climateQuery.data],
  );
  const hourlyData = useMemo(
    () =>
      summary.hourlyProfile.map((bucket) => ({
        hour: `${String(bucket.hour).padStart(2, '0')}:00`,
        duty: bucket.dutyCycle != null ? Math.round(bucket.dutyCycle * 1000) / 10 : null,
        events: bucket.eventStarts,
      })),
    [summary.hourlyProfile],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('hvacCycling.title', 'HVAC Cycling')} />;
  }

  const isLoading = climateQuery.isLoading;
  const isError = climateQuery.isError;

  return (
    <PageContainer
      title={t('hvacCycling.title', 'HVAC Cycling')}
      subtitle={t(
        'hvacCycling.subtitle',
        'Run-length behavior reconstructed from compressor, power, and fan signals',
      )}
      query={climateQuery}
      actions={<VehicleSelect />}
    >
      <FadeIn>
        <section
          aria-label={t('hvacCycling.kpis', 'HVAC cycling summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={climateQuery.error} onRetry={() => climateQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('hvacCycling.duty', 'Duty Cycle')}
                value={summary.dutyCycle != null ? `${fmtNumber(summary.dutyCycle * 100, 0)}%` : '—'}
                subtitle={t('hvacCycling.dutyHint', 'share of observed time on')}
                icon={<Gauge className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('hvacCycling.events', 'On Events')}
                value={summary.observedS > 0 ? summary.eventCount : '—'}
                subtitle={t('hvacCycling.eventsHint', 'separate active runs')}
                icon={<Fan className="h-5 w-5" />}
                color="blue"
              />
              <MetricCard
                label={t('hvacCycling.medianOn', 'Median On Run')}
                value={formatDuration(summary.medianOnS, { precision: 1 })}
                subtitle={t('hvacCycling.medianOnHint', 'duration per active event')}
                icon={<Clock3 className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('hvacCycling.shortRate', 'Short-Cycle Rate')}
                value={summary.shortCycleRate != null ? `${fmtNumber(summary.shortCycleRate * 100, 0)}%` : '—'}
                subtitle={t('hvacCycling.shortHint', 'on runs of 10 minutes or less')}
                icon={<RotateCw className="h-5 w-5" />}
                color="amber"
              />
            </>
          )}
        </section>
      </FadeIn>

      <FadeIn delay={0.1}>
        <ChartContainer
          title={t('hvacCycling.hourly.title', 'Hourly HVAC Duty')}
          subtitle={t('hvacCycling.hourly.subtitle', 'Duration-weighted on share by local hour')}
          ariaLabel={t('hvacCycling.hourly.aria', 'Bar chart of HVAC duty cycle for each hour of day')}
          loading={isLoading}
          height={340}
          data={hourlyData}
          dataColumns={[
            { key: 'hour', label: t('hvacCycling.hourly.hour', 'Hour') },
            { key: 'duty', label: t('hvacCycling.hourly.duty', 'Duty cycle (%)') },
            { key: 'events', label: t('hvacCycling.hourly.starts', 'Event starts') },
          ]}
        >
          {isError ? (
            <QueryError error={climateQuery.error} onRetry={() => climateQuery.refetch()} />
          ) : summary.observedS === 0 ? (
            <EmptyState /* no-action: duty appears after two timestamped, interpretable HVAC samples establish an interval. */
              icon={<Fan className="h-8 w-8" />}
              message={t('hvacCycling.empty', 'No timestamped HVAC intervals are available to segment yet.')}
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} />
                <XAxis dataKey="hour" tick={{ fill: chartTokens.axisStroke, fontSize: 10 }} interval={1} />
                <YAxis tick={{ fill: chartTokens.axisStroke, fontSize: 11 }} domain={[0, 100]} unit="%" />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="duty" name={t('hvacCycling.hourly.duty', 'Duty cycle (%)')} fill={chartTokens.series[5]} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartContainer>
      </FadeIn>

      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <TimerReset className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('hvacCycling.runs.title', 'Run-Length Evidence')}
          </PanelTitle>
          {isError ? (
            <QueryError error={climateQuery.error} onRetry={() => climateQuery.refetch()} />
          ) : isLoading ? (
            <Skeleton height={120} />
          ) : summary.observedS === 0 ? (
            <EmptyState /* no-action: evidence accumulates automatically from timestamped climate reporting. */
              icon={<Clock3 className="h-8 w-8" />}
              message={t('hvacCycling.runs.empty', 'Run statistics will appear after HVAC state transitions are observed.')}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <Text variant="caption" as="p">{t('hvacCycling.medianOff', 'Median off run')}</Text>
                <Text variant="body" as="p">{formatDuration(summary.medianOffS, { precision: 1 })}</Text>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <Text variant="caption" as="p">{t('hvacCycling.longest', 'Longest on run')}</Text>
                <Text variant="body" as="p">{formatDuration(summary.longestRunS, { precision: 1 })}</Text>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <Text variant="caption" as="p">{t('hvacCycling.observed', 'Observed duration')}</Text>
                <Text variant="body" as="p">{formatDuration(summary.observedS, { precision: 1 })}</Text>
              </div>
            </div>
          )}
          <Text variant="caption" as="p" className="mt-3">
            {t('hvacCycling.gapNote', 'Telemetry gaps longer than 30 minutes are excluded rather than counted as an on or off run.')}
          </Text>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
