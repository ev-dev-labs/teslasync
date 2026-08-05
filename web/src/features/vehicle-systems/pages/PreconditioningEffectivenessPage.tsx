import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flame, Gauge, Snowflake, Sparkles, ThermometerSun } from 'lucide-react';

import { useDriveHistory } from '@/api/hooks/useDriving';
import { useClimateHistory } from '@/api/hooks/useVehicleSystems';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartLegend,
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
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';
import { convertTempFromSI, type TemperatureUnitPref } from '@/lib/unitConversion';

import {
  summarizePreconditioningEffectiveness,
  type EvidenceLevel,
} from '../lib/preconditioningEffectiveness';

function convertDeltaC(valueC: number, unit: TemperatureUnitPref): number {
  return convertTempFromSI(valueC, unit) - convertTempFromSI(0, unit);
}

export default function PreconditioningEffectivenessPage() {
  const { t } = useTranslation();
  usePageTitle(t('preconditioningEffectiveness.title', 'Preconditioning Effectiveness'));
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : '';
  const { unitPrefs } = useUnits();
  const comparisonHidden = useHiddenSeries('preconditioning-effectiveness-comparison');
  const climateQuery = useClimateHistory(vehicleIdStr);
  const drivesQuery = useDriveHistory(vehicleIdStr || undefined);
  const summary = useMemo(
    () => summarizePreconditioningEffectiveness(climateQuery.data ?? [], drivesQuery.data ?? []),
    [climateQuery.data, drivesQuery.data],
  );
  const tempUnit = unitPrefs.temperature;
  const formatDelta = (valueC: number | null, signed = false): string => {
    if (valueC == null) return '—';
    const value = convertDeltaC(valueC, tempUnit);
    return `${signed && value > 0 ? '+' : ''}${fmtNumber(value, 1)} ${tempUnit}`;
  };
  const comparisonData = useMemo(
    () =>
      summary.strata.map((row) => ({
        regime:
          row.regime === 'hot'
            ? t('preconditioningEffectiveness.hot', 'Hot starts')
            : t('preconditioningEffectiveness.cold', 'Cold starts'),
        conditioned:
          row.conditionedStartDeltaC != null
            ? convertDeltaC(row.conditionedStartDeltaC, tempUnit)
            : null,
        unconditioned:
          row.unconditionedStartDeltaC != null
            ? convertDeltaC(row.unconditionedStartDeltaC, tempUnit)
            : null,
      })),
    [summary.strata, t, tempUnit],
  );

  if (vehicleId == null) {
    return (
      <NoVehicleSelected
        pageTitle={t('preconditioningEffectiveness.title', 'Preconditioning Effectiveness')}
      />
    );
  }

  const isLoading = climateQuery.isLoading || drivesQuery.isLoading;
  const isError = climateQuery.isError || drivesQuery.isError;
  const error = climateQuery.error ?? drivesQuery.error;
  const retry = () => {
    if (climateQuery.isError) void climateQuery.refetch();
    if (drivesQuery.isError) void drivesQuery.refetch();
  };
  const evidenceLabel = (level: EvidenceLevel): string =>
    level === 'strong'
      ? t('preconditioningEffectiveness.evidence.strong', 'Strong evidence')
      : level === 'moderate'
        ? t('preconditioningEffectiveness.evidence.moderate', 'Moderate evidence')
        : level === 'limited'
          ? t('preconditioningEffectiveness.evidence.limited', 'Limited evidence')
          : t('preconditioningEffectiveness.evidence.none', 'No comparison yet');

  return (
    <PageContainer
      title={t('preconditioningEffectiveness.title', 'Preconditioning Effectiveness')}
      subtitle={t(
        'preconditioningEffectiveness.subtitle',
        'Observed cabin readiness before drives, compared with unconditioned departures',
      )}
      query={[climateQuery, drivesQuery]}
      actions={<VehicleSelect />}
    >
      <FadeIn>
        <section
          aria-label={t('preconditioningEffectiveness.kpis', 'Preconditioning effectiveness summary metrics')}
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
                label={t('preconditioningEffectiveness.conditioned', 'Conditioned Departures')}
                value={summary.conditionedShare != null ? `${fmtNumber(summary.conditionedShare * 100, 0)}%` : '—'}
                subtitle={t('preconditioningEffectiveness.conditionedHint', '{{count}} of {{total}} classified', {
                  count: summary.conditionedDepartures,
                  total: summary.joinedDepartures,
                })}
                icon={<ThermometerSun className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('preconditioningEffectiveness.startDelta', 'Conditioned Start Delta')}
                value={formatDelta(summary.overall.conditionedStartDeltaC)}
                subtitle={t('preconditioningEffectiveness.startDeltaHint', 'median cabin-to-setpoint gap')}
                icon={<Gauge className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('preconditioningEffectiveness.advantage', 'Start-Delta Advantage')}
                value={formatDelta(summary.overall.startDeltaAdvantageC, true)}
                subtitle={t('preconditioningEffectiveness.advantageHint', 'unconditioned minus conditioned')}
                icon={<Sparkles className="h-5 w-5" />}
                color={(summary.overall.startDeltaAdvantageC ?? 0) > 0 ? 'green' : 'blue'}
              />
              <MetricCard
                label={t('preconditioningEffectiveness.improvementLift', 'Improvement Lift')}
                value={formatDelta(summary.overall.improvementLiftC, true)}
                subtitle={evidenceLabel(summary.overall.evidence)}
                icon={<Flame className="h-5 w-5" />}
                color={(summary.overall.improvementLiftC ?? 0) > 0 ? 'green' : 'amber'}
              />
            </>
          )}
        </section>
      </FadeIn>

      <FadeIn delay={0.1}>
        <ChartContainer
          title={t('preconditioningEffectiveness.chart.title', 'Departure Cabin Gap by Regime')}
          subtitle={t('preconditioningEffectiveness.chart.subtitle', 'Median absolute cabin-to-setpoint delta immediately before driving')}
          ariaLabel={t('preconditioningEffectiveness.chart.aria', 'Grouped bars comparing conditioned and unconditioned cabin gaps for hot and cold departures')}
          chartKey="preconditioning-effectiveness-comparison"
          loading={isLoading}
          height={340}
          data={comparisonData}
          dataColumns={[
            { key: 'regime', label: t('preconditioningEffectiveness.chart.regime', 'Regime') },
            { key: 'conditioned', label: t('preconditioningEffectiveness.chart.conditioned', 'Conditioned') },
            { key: 'unconditioned', label: t('preconditioningEffectiveness.chart.unconditioned', 'Unconditioned') },
          ]}
        >
          {isError ? (
            <QueryError error={error} onRetry={retry} />
          ) : summary.joinedDepartures === 0 ? (
            <EmptyState /* no-action: comparison appears when drives have at least two classified pre-drive climate samples. */
              icon={<ThermometerSun className="h-8 w-8" />}
              message={t('preconditioningEffectiveness.empty', 'No departures have enough classified pre-drive climate evidence yet.')}
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} />
                <XAxis dataKey="regime" tick={{ fill: chartTokens.axisStroke, fontSize: 11 }} />
                <YAxis tick={{ fill: chartTokens.axisStroke, fontSize: 11 }} unit={tempUnit} />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend state={comparisonHidden} />
                <Bar dataKey="conditioned" name={t('preconditioningEffectiveness.chart.conditioned', 'Conditioned')} fill={chartTokens.series[0]} radius={[4, 4, 0, 0]} hide={comparisonHidden.isHidden('conditioned')} />
                <Bar dataKey="unconditioned" name={t('preconditioningEffectiveness.chart.unconditioned', 'Unconditioned')} fill={chartTokens.series[2]} radius={[4, 4, 0, 0]} hide={comparisonHidden.isHidden('unconditioned')} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartContainer>
      </FadeIn>

      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Snowflake className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('preconditioningEffectiveness.strata.title', 'Hot & Cold Evidence')}
          </PanelTitle>
          {isError ? (
            <QueryError error={error} onRetry={retry} />
          ) : isLoading ? (
            <Skeleton height={150} />
          ) : summary.joinedDepartures === 0 ? (
            <EmptyState /* no-action: evidence is joined automatically from climate history around each new drive. */
              icon={<Gauge className="h-8 w-8" />}
              message={t('preconditioningEffectiveness.strata.empty', 'Stratified evidence will appear with classified departures.')}
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {summary.strata.map((row) => (
                <div key={row.regime} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                  <Text variant="body" as="p">
                    {row.regime === 'hot'
                      ? t('preconditioningEffectiveness.hot', 'Hot starts')
                      : t('preconditioningEffectiveness.cold', 'Cold starts')}
                  </Text>
                  <Text variant="caption" as="p" className="mt-1">
                    {t('preconditioningEffectiveness.strata.counts', '{{conditioned}} conditioned · {{control}} unconditioned · {{evidence}}', {
                      conditioned: row.conditionedCount,
                      control: row.unconditionedCount,
                      evidence: evidenceLabel(row.evidence),
                    })}
                  </Text>
                  <Text variant="bodySm" as="p" className="mt-2">
                    {t('preconditioningEffectiveness.strata.medians', 'Start advantage {{start}}; improvement lift {{improvement}}.', {
                      start: formatDelta(row.startDeltaAdvantageC, true),
                      improvement: formatDelta(row.improvementLiftC, true),
                    })}
                  </Text>
                </div>
              ))}
            </div>
          )}
          <Text variant="caption" as="p" className="mt-3">
            {t('preconditioningEffectiveness.observational', 'Observational medians only: this view does not estimate or claim energy savings.')}
          </Text>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
