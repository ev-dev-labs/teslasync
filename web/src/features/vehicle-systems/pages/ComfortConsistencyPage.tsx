import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, ShieldCheck, SlidersHorizontal, Thermometer, TimerReset } from 'lucide-react';

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
import { convertTempFromSI, type TemperatureUnitPref } from '@/lib/unitConversion';

import { summarizeComfortConsistency } from '../lib/comfortConsistency';

function convertDeltaC(valueC: number, unit: TemperatureUnitPref): number {
  return convertTempFromSI(valueC, unit) - convertTempFromSI(0, unit);
}

export default function ComfortConsistencyPage() {
  const { t } = useTranslation();
  usePageTitle(t('comfortConsistency.title', 'Comfort Consistency'));
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : '';
  const { unitPrefs, formatDuration } = useUnits();
  const climateQuery = useClimateHistory(vehicleIdStr);
  const summary = useMemo(
    () => summarizeComfortConsistency(climateQuery.data ?? []),
    [climateQuery.data],
  );
  const tempUnit = unitPrefs.temperature;
  const formatDelta = (valueC: number | null): string =>
    valueC != null ? `${fmtNumber(convertDeltaC(valueC, tempUnit), 1)} ${tempUnit}` : '—';
  const overshootData = useMemo(
    () =>
      summary.overshootDistribution.map((bin) => {
        const lower = fmtNumber(convertDeltaC(bin.lowerC, tempUnit), 1);
        const upper = bin.upperC != null ? fmtNumber(convertDeltaC(bin.upperC, tempUnit), 1) : null;
        return {
          range:
            upper != null
              ? t('comfortConsistency.overshoot.range', '{{lower}}–{{upper}}', { lower, upper })
              : t('comfortConsistency.overshoot.openRange', '{{lower}}+', { lower }),
          windows: bin.windows,
        };
      }),
    [summary.overshootDistribution, t, tempUnit],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('comfortConsistency.title', 'Comfort Consistency')} />;
  }

  const isLoading = climateQuery.isLoading;
  const isError = climateQuery.isError;

  return (
    <PageContainer
      title={t('comfortConsistency.title', 'Comfort Consistency')}
      subtitle={t(
        'comfortConsistency.subtitle',
        'How closely active climate control holds the cabin to both front-row setpoints',
      )}
      query={climateQuery}
      actions={<VehicleSelect />}
    >
      <FadeIn>
        <section
          aria-label={t('comfortConsistency.kpis', 'Comfort consistency summary metrics')}
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
                label={t('comfortConsistency.score', 'Consistency Score')}
                value={summary.consistencyScore ?? '—'}
                subtitle={t('comfortConsistency.scoreHint', '{{confidence}}% evidence confidence', {
                  confidence: fmtNumber(summary.confidence * 100, 0),
                })}
                icon={<ShieldCheck className="h-5 w-5" />}
                color={summary.consistencyScore == null ? 'cyan' : summary.consistencyScore >= 80 ? 'green' : summary.consistencyScore >= 60 ? 'amber' : 'red'}
              />
              <MetricCard
                label={t('comfortConsistency.inBand', 'Within Comfort Band')}
                value={summary.withinComfortBandShare != null ? `${fmtNumber(summary.withinComfortBandShare * 100, 0)}%` : '—'}
                subtitle={t('comfortConsistency.inBandHint', 'within ±{{band}} of the mean setpoint', {
                  band: formatDelta(1.5),
                })}
                icon={<Gauge className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('comfortConsistency.medianDeviation', 'Median Deviation')}
                value={formatDelta(summary.medianAbsDeviationC)}
                subtitle={t('comfortConsistency.deviationHint', 'absolute cabin-to-setpoint gap')}
                icon={<Thermometer className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('comfortConsistency.stabilization', 'Median Stabilization')}
                value={formatDuration(summary.medianStabilizationS, { precision: 1 })}
                subtitle={t('comfortConsistency.stabilizationHint', '{{count}} stabilized windows', {
                  count: summary.stabilizedWindows,
                })}
                icon={<TimerReset className="h-5 w-5" />}
                color="blue"
              />
            </>
          )}
        </section>
      </FadeIn>

      <FadeIn delay={0.1}>
        <ChartContainer
          title={t('comfortConsistency.overshoot.title', 'Overshoot Distribution')}
          subtitle={t('comfortConsistency.overshoot.subtitle', 'Opposite-side peak after an HVAC run begins outside the comfort band')}
          ariaLabel={t('comfortConsistency.overshoot.aria', 'Bar chart of stabilization windows grouped by temperature overshoot')}
          loading={isLoading}
          height={320}
          data={overshootData}
          dataColumns={[
            { key: 'range', label: t('comfortConsistency.overshoot.band', 'Overshoot band') },
            { key: 'windows', label: t('comfortConsistency.overshoot.windows', 'Windows') },
          ]}
        >
          {isError ? (
            <QueryError error={climateQuery.error} onRetry={() => climateQuery.refetch()} />
          ) : summary.stabilizationWindows.length === 0 ? (
            <EmptyState /* no-action: windows appear when active HVAC starts with the cabin outside the comfort band. */
              icon={<Thermometer className="h-8 w-8" />}
              message={t('comfortConsistency.empty', 'No active HVAC stabilization window has been captured yet.')}
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={overshootData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} />
                <XAxis dataKey="range" tick={{ fill: chartTokens.axisStroke, fontSize: 11 }} />
                <YAxis tick={{ fill: chartTokens.axisStroke, fontSize: 11 }} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="windows" name={t('comfortConsistency.overshoot.windows', 'Windows')} fill={chartTokens.series[4]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartContainer>
      </FadeIn>

      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('comfortConsistency.evidence.title', 'Setpoint & Evidence Readout')}
          </PanelTitle>
          {isError ? (
            <QueryError error={climateQuery.error} onRetry={() => climateQuery.refetch()} />
          ) : isLoading ? (
            <Skeleton height={120} />
          ) : summary.analyzedSamples === 0 ? (
            <EmptyState /* no-action: active climate samples with cabin and setpoint temperatures are recorded automatically. */
              icon={<Gauge className="h-8 w-8" />}
              message={t('comfortConsistency.evidence.empty', 'No active HVAC samples have both cabin and setpoint temperatures yet.')}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <Text variant="caption" as="p">{t('comfortConsistency.disagreement', 'Mean left–right disagreement')}</Text>
                <Text variant="body" as="p">{formatDelta(summary.meanSetpointDisagreementC)}</Text>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <Text variant="caption" as="p">{t('comfortConsistency.p90', '90th-percentile deviation')}</Text>
                <Text variant="body" as="p">{formatDelta(summary.p90AbsDeviationC)}</Text>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <Text variant="caption" as="p">{t('comfortConsistency.overshootMedian', 'Median overshoot')}</Text>
                <Text variant="body" as="p">{formatDelta(summary.medianOvershootC)}</Text>
              </div>
            </div>
          )}
          <Text variant="caption" as="p" className="mt-3">
            {t('comfortConsistency.evidence.note', 'The score uses {{samples}} active samples and is shrunk toward neutral when evidence is sparse.', {
              samples: summary.analyzedSamples,
            })}
          </Text>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
