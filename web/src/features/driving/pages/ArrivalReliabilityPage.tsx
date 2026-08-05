import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlarmClockCheck, Clock3, Route, ShieldCheck, TimerReset } from 'lucide-react';

import { useDriveHistory } from '@/api/hooks/useDriving';
import {
  Bar,
  CartesianGrid,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  ComposedChart,
  Line,
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
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { chartTokens } from '@/lib/tokens';

import { analyzeArrivalReliability, type ReliabilityWindow } from '../lib/arrivalReliability';

function percent(value: number | null): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

export default function ArrivalReliabilityPage() {
  const { t } = useTranslation();
  usePageTitle(t('arrivalReliability.title', 'Arrival Reliability'));
  const { vehicleId } = useSelectedVehicle();
  const { formatDuration } = useUnits();
  const hidden = useHiddenSeries('arrival-reliability-routes');
  const drivesQuery = useDriveHistory(vehicleId != null ? String(vehicleId) : undefined);
  const result = useMemo(
    () => analyzeArrivalReliability(drivesQuery.data ?? []),
    [drivesQuery.data],
  );
  const chartData = useMemo(
    () => result.routes.slice(0, 10).map((route) => ({
      route: route.label,
      reliability: Math.round(route.reliabilityScore),
      onTime: Math.round(route.onTimeProbability * 100),
    })),
    [result.routes],
  );
  const windowLabel = (window: ReliabilityWindow | null) => {
    if (!window) return '—';
    const end = (window.bucketStartHour + 2) % 24;
    return t('arrivalReliability.windowValue', '{{start}}:00–{{end}}:00', {
      start: String(window.bucketStartHour).padStart(2, '0'),
      end: String(end).padStart(2, '0'),
    });
  };

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('arrivalReliability.title', 'Arrival Reliability')} />;
  }
  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;
  const typicalSpread = result.routes.length > 0
    ? result.routes.reduce((sum, route) => sum + route.robustSpreadS, 0) / result.routes.length
    : null;

  return (
    <PageContainer
      title={t('arrivalReliability.title', 'Arrival Reliability')}
      subtitle={t('arrivalReliability.subtitle', 'Timing uncertainty on routes you drive repeatedly')}
      query={drivesQuery}
      actions={<VehicleSelect />}
    >
      <FadeIn>
        <section
          aria-label={t('arrivalReliability.kpis', 'Arrival reliability summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('arrivalReliability.repeatedRoutes', 'Repeated Routes')}
                value={result.routes.length}
                subtitle={t('arrivalReliability.repeatedDrives', '{{count}} drives matched', { count: result.repeatedDrives })}
                icon={<Route className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('arrivalReliability.score', 'Reliability Score')}
                value={result.overallReliabilityScore != null ? Math.round(result.overallReliabilityScore) : '—'}
                subtitle={t('arrivalReliability.of100', 'of 100')}
                icon={<ShieldCheck className="h-5 w-5" />}
                color="green"
              />
              <MetricCard
                label={t('arrivalReliability.onTime', 'On-time Probability')}
                value={percent(result.overallOnTimeProbability)}
                subtitle={t('arrivalReliability.tolerance', 'within the robust route allowance')}
                icon={<AlarmClockCheck className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('arrivalReliability.spread', 'Typical Robust Spread')}
                value={typicalSpread != null ? formatDuration(typicalSpread, { precision: 1 }) : '—'}
                subtitle={t('arrivalReliability.mad', 'median absolute deviation scale')}
                icon={<TimerReset className="h-5 w-5" />}
                color="amber"
              />
            </>
          )}
        </section>
      </FadeIn>

      <FadeIn delay={0.1}>
        {isError ? (
          <GlassPanel className="p-4 sm:p-5">
            <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
          </GlassPanel>
        ) : !isLoading && chartData.length === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: repeated routes emerge automatically after three matched drives. */
              icon={<Route className="h-8 w-8" />}
              message={t('arrivalReliability.noRoutes', 'No route has enough repeated drives to estimate timing uncertainty yet.')}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('arrivalReliability.routeChart', 'Route Reliability')}
            subtitle={t('arrivalReliability.routeChartHint', 'Score combines on-time frequency with robust duration spread')}
            ariaLabel={t('arrivalReliability.routeChartAria', 'Reliability score and on-time probability for repeated routes')}
            chartKey="arrival-reliability-routes"
            loading={isLoading}
            empty={chartData.length === 0}
            height={340}
            data={chartData}
            dataColumns={[
              { key: 'route', label: t('arrivalReliability.colRoute', 'Route') },
              { key: 'reliability', label: t('arrivalReliability.colReliability', 'Reliability score') },
              { key: 'onTime', label: t('arrivalReliability.colOnTime', 'On time (%)') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="route" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval={0} />
                <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend state={hidden} />
                <Bar
                  dataKey="reliability"
                  name={t('arrivalReliability.reliability', 'Reliability')}
                  fill={chartTokens.series[0]}
                  radius={[3, 3, 0, 0]}
                  hide={hidden.isHidden('reliability')}
                />
                <Line
                  type="monotone"
                  dataKey="onTime"
                  name={t('arrivalReliability.onTimeShort', 'On time')}
                  stroke={chartTokens.series[2]}
                  strokeWidth={2}
                  hide={hidden.isHidden('onTime')}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('arrivalReliability.windows', 'Best and Worst Departure Windows')}
          </PanelTitle>
          {isError ? (
            <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
          ) : isLoading ? (
            <Skeleton height={96} />
          ) : !result.bestWindow || !result.worstWindow ? (
            <EmptyState /* no-action: windows need two drives in the same route and two-hour bucket. */
              icon={<Clock3 className="h-8 w-8" />}
              message={t('arrivalReliability.noWindows', 'No repeated departure window has enough evidence yet.')}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { key: 'best', title: t('arrivalReliability.best', 'Most reliable'), value: result.bestWindow },
                { key: 'worst', title: t('arrivalReliability.worst', 'Least reliable'), value: result.worstWindow },
              ].map((item) => (
                <div key={item.key} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                  <Text as="p" variant="label">{item.title}</Text>
                  <Text as="p" variant="bodySm">{item.value.routeLabel}</Text>
                  <Text as="p" variant="caption">
                    {windowLabel(item.value)} · {percent(item.value.onTimeProbability)}
                  </Text>
                  <Text as="p" variant="caption">
                    {t('arrivalReliability.durationRange', 'p50 {{p50}} · p90 {{p90}}', {
                      p50: formatDuration(item.value.p50DurationS, { precision: 1 }),
                      p90: formatDuration(item.value.p90DurationS, { precision: 1 }),
                    })}
                  </Text>
                </div>
              ))}
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
