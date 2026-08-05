import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, BatteryCharging, Gauge, Layers, TrendingUp } from 'lucide-react';

import { useChargingHistory } from '@/api/hooks/useCharging';
import { useDriveHistory } from '@/api/hooks/useDriving';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  Line,
  LineChart,
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
import { fmtNumber } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';

import {
  DEEP_CYCLE_THRESHOLD_PCT,
  DEPTH_STRESS_EXPONENT,
  summarizeCycleStress,
} from '../lib/cycleStress';

export default function CycleStressPage() {
  const { t } = useTranslation();
  usePageTitle(t('cycleStress.title', 'Cycle Stress'));
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const trendHidden = useHiddenSeries('cycle-stress-trend');
  const sessionsQuery = useChargingHistory(vehicleIdStr);
  const drivesQuery = useDriveHistory(vehicleIdStr);

  const summary = useMemo(
    () => summarizeCycleStress(sessionsQuery.data ?? [], drivesQuery.data ?? []),
    [sessionsQuery.data, drivesQuery.data],
  );
  const histogram = useMemo(
    () =>
      summary.histogram.map((bin) => ({
        range: t('cycleStress.histogram.range', '{{low}}–{{high}}%', {
          low: bin.lowerPct,
          high: bin.upperPct,
        }),
        cycles: bin.cycles,
      })),
    [summary.histogram, t],
  );
  const trendData = useMemo(
    () =>
      summary.recentTrend.map((point) => ({
        month: point.month,
        equivalentFullCycles: point.equivalentFullCycles,
        stressEquivalentCycles: point.stressEquivalentCycles,
      })),
    [summary.recentTrend],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('cycleStress.title', 'Cycle Stress')} />;
  }

  const isLoading = sessionsQuery.isLoading || drivesQuery.isLoading;
  const isError = sessionsQuery.isError || drivesQuery.isError;
  const error = sessionsQuery.error ?? drivesQuery.error;
  const retry = () => {
    if (sessionsQuery.isError) void sessionsQuery.refetch();
    if (drivesQuery.isError) void drivesQuery.refetch();
  };

  return (
    <PageContainer
      title={t('cycleStress.title', 'Cycle Stress')}
      subtitle={t(
        'cycleStress.subtitle',
        'Observed depth stress reconstructed from up to 1,000 recent drives and charge sessions',
      )}
      query={[sessionsQuery, drivesQuery]}
      actions={<VehicleSelect />}
    >
      <FadeIn>
        <section
          aria-label={t('cycleStress.kpis', 'Cycle stress summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={error} onRetry={retry} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('cycleStress.efc', 'Observed Full Cycles')}
                value={summary.cycles.length > 0 ? fmtNumber(summary.equivalentFullCycles, 2) : '—'}
                subtitle={t('cycleStress.efcHint', 'linear sum of cycle depth')}
                icon={<BatteryCharging className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('cycleStress.stressCycles', 'Observed Stress Cycles')}
                value={summary.cycles.length > 0 ? fmtNumber(summary.stressEquivalentCycles, 2) : '—'}
                subtitle={t('cycleStress.stressHint', 'nonlinear depth-weighted total')}
                icon={<Activity className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('cycleStress.meanDepth', 'Mean Cycle Depth')}
                value={summary.meanDepthPct != null ? `${fmtNumber(summary.meanDepthPct, 1)}%` : '—'}
                subtitle={t('cycleStress.meanDepthHint', 'half cycles included')}
                icon={<Gauge className="h-5 w-5" />}
                color="blue"
              />
              <MetricCard
                label={t('cycleStress.deepShare', 'Deep-Cycle Share')}
                value={summary.deepCycleShare != null ? `${fmtNumber(summary.deepCycleShare * 100, 0)}%` : '—'}
                subtitle={t('cycleStress.deepHint', '{{depth}}% DoD or deeper', {
                  depth: DEEP_CYCLE_THRESHOLD_PCT,
                })}
                icon={<Layers className="h-5 w-5" />}
                color="amber"
              />
            </>
          )}
        </section>
      </FadeIn>

      <FadeIn delay={0.1}>
        <ChartContainer
          title={t('cycleStress.histogram.title', 'Cycle Depth Distribution')}
          subtitle={t('cycleStress.histogram.subtitle', 'Rainflow cycle count, including half cycles')}
          ariaLabel={t('cycleStress.histogram.aria', 'Bar chart of weighted cycle count by depth-of-discharge band')}
          loading={isLoading}
          height={320}
          data={histogram}
          dataColumns={[
            { key: 'range', label: t('cycleStress.histogram.depth', 'Depth band') },
            { key: 'cycles', label: t('cycleStress.histogram.cycles', 'Cycles') },
          ]}
        >
          {isError ? (
            <QueryError error={error} onRetry={retry} />
          ) : summary.cycles.length === 0 ? (
            <EmptyState /* no-action: cycles appear automatically as drive and charge SoC boundaries accumulate. */
              icon={<Layers className="h-8 w-8" />}
              message={t('cycleStress.empty', 'Not enough SoC reversals have been recorded to extract a cycle yet.')}
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={histogram}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} />
                <XAxis dataKey="range" tick={{ fill: chartTokens.axisStroke, fontSize: 11 }} />
                <YAxis tick={{ fill: chartTokens.axisStroke, fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="cycles" name={t('cycleStress.histogram.cycles', 'Cycles')} fill={chartTokens.series[0]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartContainer>
      </FadeIn>

      <FadeIn delay={0.2}>
        <ChartContainer
          title={t('cycleStress.trend.title', 'Observed Cycle-Depth Trend')}
          subtitle={t('cycleStress.trend.subtitle', 'Monthly linear depth beside nonlinear depth stress')}
          ariaLabel={t('cycleStress.trend.aria', 'Monthly line chart comparing equivalent full cycles with stress-equivalent cycles')}
          chartKey="cycle-stress-trend"
          loading={isLoading}
          height={320}
          data={trendData}
          dataColumns={[
            { key: 'month', label: t('cycleStress.trend.month', 'Month') },
            { key: 'equivalentFullCycles', label: t('cycleStress.efc', 'Equivalent Full Cycles') },
            { key: 'stressEquivalentCycles', label: t('cycleStress.stressCycles', 'Stress-Equivalent Cycles') },
          ]}
        >
          {isError ? (
            <QueryError error={error} onRetry={retry} />
          ) : trendData.length === 0 ? (
            <EmptyState /* no-action: monthly trend is derived from the same automatically recorded boundaries. */
              icon={<TrendingUp className="h-8 w-8" />}
              message={t('cycleStress.trend.empty', 'A monthly trend will appear after the first extracted cycle.')}
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} />
                <XAxis dataKey="month" tick={{ fill: chartTokens.axisStroke, fontSize: 11 }} />
                <YAxis tick={{ fill: chartTokens.axisStroke, fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend state={trendHidden} />
                <Line type="monotone" dataKey="equivalentFullCycles" name={t('cycleStress.trend.linear', 'Linear depth')} stroke={chartTokens.series[0]} strokeWidth={2} dot={false} hide={trendHidden.isHidden('equivalentFullCycles')} />
                <Line type="monotone" dataKey="stressEquivalentCycles" name={t('cycleStress.trend.stress', 'Depth stress')} stroke={chartTokens.series[4]} strokeWidth={2} dot={false} hide={trendHidden.isHidden('stressEquivalentCycles')} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartContainer>
      </FadeIn>

      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('cycleStress.model.title', 'How Depth Stress Is Counted')}
          </PanelTitle>
          <Text variant="bodySm" as="p">
            {t(
              'cycleStress.model.body',
              'Chronological SoC turning points in the loaded history window are rainflow-counted so closed swings become full cycles and open history edges stay half cycles. Stress uses DoD raised to {{exponent}}; it is a relative depth index, not a lifetime count or pack-health forecast.',
              { exponent: DEPTH_STRESS_EXPONENT },
            )}
          </Text>
          <Text variant="caption" as="p" className="mt-2">
            {t('cycleStress.model.evidence', '{{points}} turning points produced {{cycles}} weighted cycles.', {
              points: summary.turningPoints.length,
              cycles: fmtNumber(summary.weightedCycleCount, 1),
            })}
          </Text>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
