import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarRange, Gauge, TrendingUp, Waves } from 'lucide-react';

import { useDriveHistory } from '@/api/hooks/useDriving';
import {
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
import { useUnits } from '@/hooks/useUnits';
import { chartTokens } from '@/lib/tokens';

import { analyzeSeasonalEfficiency } from '../lib/seasonalEfficiency';

const MONTHS = [
  ['seasonalEfficiency.month.jan', 'Jan'], ['seasonalEfficiency.month.feb', 'Feb'],
  ['seasonalEfficiency.month.mar', 'Mar'], ['seasonalEfficiency.month.apr', 'Apr'],
  ['seasonalEfficiency.month.may', 'May'], ['seasonalEfficiency.month.jun', 'Jun'],
  ['seasonalEfficiency.month.jul', 'Jul'], ['seasonalEfficiency.month.aug', 'Aug'],
  ['seasonalEfficiency.month.sep', 'Sep'], ['seasonalEfficiency.month.oct', 'Oct'],
  ['seasonalEfficiency.month.nov', 'Nov'], ['seasonalEfficiency.month.dec', 'Dec'],
] as const;

export default function SeasonalEfficiencyPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(t('seasonalEfficiency.title', 'Seasonal Efficiency'));
  const { vehicleId } = useSelectedVehicle();
  const { formatDistance, formatEnergy } = useUnits();
  const hidden = useHiddenSeries('seasonal-efficiency-observed');
  const drivesQuery = useDriveHistory(vehicleId != null ? String(vehicleId) : undefined);
  const result = useMemo(
    () => analyzeSeasonalEfficiency(drivesQuery.data ?? []),
    [drivesQuery.data],
  );
  const monthData = useMemo(
    () => result.months.map((month) => ({
      month: t(MONTHS[month.month]![0], MONTHS[month.month]![1]),
      index: Math.round(month.index * 10) / 10,
    })),
    [result.months, t],
  );
  const observationData = useMemo(() => {
    const baseline = result.actualWhPerKm ?? 0;
    if (baseline <= 0) return [];
    return result.observations
      .filter((row) => row.expectedWhPerKm != null && row.deseasonalizedWhPerKm != null)
      .map((row) => ({
        date: new Date(row.timestampMs).toLocaleDateString(i18n.language, { month: 'short', year: '2-digit' }),
        actual: Math.round(1000 * row.actualWhPerKm / baseline) / 10,
        expected: Math.round(1000 * row.expectedWhPerKm! / baseline) / 10,
        deseasonalized: Math.round(1000 * row.deseasonalizedWhPerKm! / baseline) / 10,
      }));
  }, [i18n.language, result.actualWhPerKm, result.observations]);
  const efficiency = (value: number | null) => value == null ? '—' : t(
    'seasonalEfficiency.efficiencyValue',
    '{{energy}} / {{distance}}',
    {
      energy: formatEnergy(value, { precision: 2 }),
      distance: formatDistance(1000, { precision: 1 }),
    },
  );
  const trendDelta = (value: number | null) => value == null ? '—' : t(
    'seasonalEfficiency.trendValue',
    '{{sign}}{{energy}} / {{distance}} / yr',
    {
      sign: value > 0 ? '+' : value < 0 ? '−' : '',
      energy: formatEnergy(Math.abs(value), { precision: 2 }),
      distance: formatDistance(1000, { precision: 1 }),
    },
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('seasonalEfficiency.title', 'Seasonal Efficiency')} />;
  }
  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;
  const hasFit = result.coefficients != null;

  return (
    <PageContainer
      title={t('seasonalEfficiency.title', 'Seasonal Efficiency')}
      subtitle={t('seasonalEfficiency.subtitle', 'Distance-weighted seasonal normalization with a long-term trend')}
      query={drivesQuery}
      actions={<VehicleSelect />}
    >
      <FadeIn>
        <section
          aria-label={t('seasonalEfficiency.kpis', 'Seasonal efficiency summary metrics')}
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
                label={t('seasonalEfficiency.analyzed', 'Drives Modeled')}
                value={result.sampleCount}
                subtitle={formatDistance(result.totalDistanceM, { precision: 0 })}
                icon={<CalendarRange className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('seasonalEfficiency.actual', 'Actual Intensity')}
                value={efficiency(result.actualWhPerKm)}
                subtitle={t('seasonalEfficiency.expectedValue', 'expected: {{value}}', { value: efficiency(result.expectedWhPerKm) })}
                icon={<Gauge className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('seasonalEfficiency.rSquared', 'Model R²')}
                value={result.rSquared != null ? result.rSquared.toFixed(2) : '—'}
                subtitle={t('seasonalEfficiency.fitHint', 'annual + semiannual + trend')}
                icon={<Waves className="h-5 w-5" />}
                color="green"
              />
              <MetricCard
                label={t('seasonalEfficiency.trend', 'Deseasonalized Trend')}
                value={trendDelta(result.trendWhPerKmPerYear)}
                subtitle={t('seasonalEfficiency.perYear', '{{days}} days of observed history', {
                  days: Math.round(result.spanDays),
                })}
                icon={<TrendingUp className="h-5 w-5" />}
                color={result.trendWhPerKmPerYear != null && result.trendWhPerKmPerYear > 0 ? 'amber' : 'blue'}
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
        ) : !isLoading && !hasFit ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: the harmonic model appears after enough valid drives span at least nine months. */
              icon={<Waves className="h-8 w-8" />}
              message={t(
                'seasonalEfficiency.noFit',
                'Annual seasonality needs at least nine months of valid drive history. Current coverage: {{days}} days.',
                { days: Math.round(result.spanDays) },
              )}
            />
          </GlassPanel>
        ) : (
          <section className="grid gap-4 xl:grid-cols-2">
            <ChartContainer
              title={t('seasonalEfficiency.monthly', 'Monthly Seasonal Index')}
              subtitle={t('seasonalEfficiency.monthlyHint', '100 is the fitted year-round baseline; trend is held constant')}
              ariaLabel={t('seasonalEfficiency.monthlyAria', 'Fitted monthly seasonal efficiency index')}
              loading={isLoading}
              empty={monthData.length === 0}
              height={330}
              data={monthData}
              dataColumns={[
                { key: 'month', label: t('seasonalEfficiency.colMonth', 'Month') },
                { key: 'index', label: t('seasonalEfficiency.colIndex', 'Seasonal index') },
              ]}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="index" name={t('seasonalEfficiency.seasonalIndex', 'Seasonal index')} stroke={chartTokens.series[0]} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>

            <ChartContainer
              title={t('seasonalEfficiency.observed', 'Expected vs Actual')}
              subtitle={t('seasonalEfficiency.observedHint', 'Actual, fitted, and seasonally adjusted intensity as an index')}
              ariaLabel={t('seasonalEfficiency.observedAria', 'Actual, expected, and deseasonalized efficiency indices over time')}
              chartKey="seasonal-efficiency-observed"
              loading={isLoading}
              empty={observationData.length === 0}
              height={330}
              data={observationData}
              dataColumns={[
                { key: 'date', label: t('seasonalEfficiency.colDate', 'Date') },
                { key: 'actual', label: t('seasonalEfficiency.colActual', 'Actual index') },
                { key: 'expected', label: t('seasonalEfficiency.colExpected', 'Expected index') },
                { key: 'deseasonalized', label: t('seasonalEfficiency.colAdjusted', 'Deseasonalized index') },
              ]}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={observationData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} minTickGap={24} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <ChartLegend state={hidden} />
                  <Line type="monotone" dataKey="actual" name={t('seasonalEfficiency.actualShort', 'Actual')} stroke={chartTokens.series[3]} dot={false} hide={hidden.isHidden('actual')} />
                  <Line type="monotone" dataKey="expected" name={t('seasonalEfficiency.expectedShort', 'Expected')} stroke={chartTokens.series[0]} dot={false} strokeWidth={2} hide={hidden.isHidden('expected')} />
                  <Line type="monotone" dataKey="deseasonalized" name={t('seasonalEfficiency.adjustedShort', 'Deseasonalized')} stroke={chartTokens.series[1]} dot={false} hide={hidden.isHidden('deseasonalized')} />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>
          </section>
        )}
      </FadeIn>

      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Waves className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('seasonalEfficiency.limitsTitle', 'Residual Band and Interpretation Limits')}
          </PanelTitle>
          {isError ? (
            <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
          ) : isLoading ? (
            <Skeleton height={96} />
          ) : !result.residualBand ? (
            <EmptyState /* no-action: residual bands appear with a fitted seasonal model. */
              icon={<Waves className="h-8 w-8" />}
              message={t('seasonalEfficiency.noResiduals', 'No fitted residual band is available yet.')}
            />
          ) : (
            <>
              <Text as="p" variant="bodySm">
                {t('seasonalEfficiency.residualBand', 'Central residual band: {{lower}} to {{upper}}', {
                  lower: efficiency(result.residualBand.lowerWhPerKm),
                  upper: efficiency(result.residualBand.upperWhPerKm),
                })}
              </Text>
              <Text as="p" variant="caption" className="mt-2">
                {t('seasonalEfficiency.limits', 'The harmonic curve normalizes recurring calendar timing only. Route mix, weather, tyres, firmware, charging losses, and driving behavior may still explain both the seasonal shape and the residual band; this model does not assign causality.')}
              </Text>
            </>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
