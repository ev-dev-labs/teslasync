import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, ChartTooltip, EmbeddedChart, axisTick, axisTickSm, chartGrid, useThemeChartPalette } from '@/components/charts';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useDrivingDynamics, useAccelerationDistribution } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetGaugeHero } from './shared';
import { knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { useDataState } from '@/hooks/useDataState';
import type { WidgetProps } from './types';

const G_MAX = 1.2;

type Severity = 'calm' | 'normal' | 'sporty' | 'aggressive';

function deriveSeverity(avgAccel: number, avgBrake: number): Severity {
  const avg = (avgAccel + avgBrake) / 2;
  if (avg < 0.15) return 'calm';
  if (avg < 0.3) return 'normal';
  if (avg < 0.5) return 'sporty';
  return 'aggressive';
}

function isSmooth(maxG: number): boolean {
  return maxG < 0.4;
}

function gaugeColor(g: number): string {
  if (g < 0.2) return '#10b981';
  if (g < 0.4) return '#22d3ee';
  if (g < 0.6) return '#f59e0b';
  return '#ef4444';
}

export default function DrivingDynamicsWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const {
    data: dynamics,
    isLoading: dynLoading,
    error: dynError,
    isFetching: dynFetching,
    isStale: dynStale,
    isError: dynIsError,
    dataUpdatedAt: dynUpdatedAt,
    refetch: dynRefetch,
  } = useDrivingDynamics(vehicleIdStr);

  const {
    data: distData,
    isLoading: distLoading,
    isFetching: distFetching,
    error: distError,
    isError: distIsError,
    isStale: distStale,
    refetch: distRefetch,
    dataUpdatedAt: distUpdatedAt,
  } = useAccelerationDistribution(vehicleIdStr);

  const isLoading = !dynamics && !distData && dynLoading;
  const updatedAt = dynUpdatedAt > 0 && distUpdatedAt > 0
    ? Math.min(dynUpdatedAt, distUpdatedAt)
    : Math.max(dynUpdatedAt ?? 0, distUpdatedAt ?? 0);
  const isFetching = dynFetching || distFetching;

  // Only replace the whole widget with a full-panel error on the INITIAL
  // load failure, when there is no cached data to fall back on. Once we have
  // data, a transient background-refetch failure must not blank out
  // otherwise-valid numbers — it is surfaced through the freshness
  // indicator's error state instead (WidgetShell forwards `isError` to
  // <DataFreshness>).
  const trust = useDataState({
    data: dynamics ?? distData, error: dynError ?? distError, isLoading: dynLoading, isFetching,
    isError: dynIsError || distIsError, isStale: dynStale || distStale, dataUpdatedAt: updatedAt, refetch: dynRefetch,
  }, { provenance: 'historical' });
  const blockingError = !distData ? trust.fatalError?.message ?? null : null;
  const refresh = () => {
    void dynRefetch();
    void distRefetch?.();
  };

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  // Chart colors derive from the active theme.
  const palette = useThemeChartPalette();

  const peaks = [dynamics?.maxAccelerationG, dynamics?.maxBrakingG, dynamics?.maxCorneringG].map(knownNumber);
  const knownPeaks = peaks.filter((value): value is number => value != null);
  const maxG = knownPeaks.length > 0 ? Math.max(...knownPeaks) : null;
  const smooth = maxG != null && isSmooth(maxG);
  const completePeaks = knownPeaks.length === peaks.length;

  const severity = useMemo(
    () => {
      const acceleration = knownNumber(dynamics?.avgAccelerationG);
      const braking = knownNumber(dynamics?.avgBrakingG);
      return acceleration == null || braking == null ? null : deriveSeverity(acceleration, braking);
    },
    [dynamics?.avgAccelerationG, dynamics?.avgBrakingG],
  );

  const histogramData = useMemo(() => {
    const values = safeArray(distData?.values);
    if (values.length === 0) return [];
    const step = G_MAX / values.length;
    return values.map((count, i) => ({
      range: `${fmtNumber(i * step, 2)}`,
      count: knownNumber(count),
    }));
  }, [distData]);

  // Compact layout: large number + badge
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        dataState={trust.hasData ? trust : undefined}
        error={blockingError}
        updatedAt={updatedAt}
        isFetching={isFetching}
        isStale={dynStale || distStale}
        isError={dynIsError || distIsError}
        onRefresh={refresh}
      >
        {dynamics ? (
          <div className="h-full flex flex-col items-center justify-center gap-2">
            <WidgetBigNumber
              value={maxG == null ? null : fmtNumber(maxG, 2)}
              label={t('widget.drivingDynamics.maxG', 'Max g')}
              align="center"
              animated={false}
              subtitle={!completePeaks ? t('widget.drivingDynamics.partialPeaks', 'Partial peak readings') : undefined}
            />
            {completePeaks && <Badge
              variant={smooth ? 'success' : 'warning'}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              {smooth
                ? t('widget.drivingDynamics.smooth', 'Smooth')
                : t('widget.drivingDynamics.aggressive', 'Aggressive')}
            </Badge>}
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Gauge className="h-5 w-5" />}
            message={t('widget.drivingDynamics.noData', 'No dynamics data')}
            className="py-2"
          />
        )}
      </WidgetShell>
    );
  }

  // Standard + Wide layout
  return (
    <WidgetShell
      title={t('widget.drivingDynamics.title', 'Driving dynamics')}
      icon={<Gauge className="h-3.5 w-3.5" aria-hidden="true" />}
      loading={isLoading}
      dataState={trust.hasData ? trust : undefined}
      error={blockingError}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={dynStale || distStale}
      isError={dynIsError || distIsError}
      onRefresh={refresh}
    >
      {dynamics || histogramData.length > 0 ? (
        <div className="min-h-full min-w-0 flex flex-col gap-3">
          {/* 3 LinearGauges */}
          <div className="grid grid-cols-1 @xs:grid-cols-3 gap-3">
            {[
              { label: t('widget.drivingDynamics.accel', 'Accel'), value: knownNumber(dynamics?.avgAccelerationG) },
              { label: t('widget.drivingDynamics.brake', 'Brake'), value: knownNumber(dynamics?.avgBrakingG) },
              { label: t('widget.drivingDynamics.lateral', 'Lateral'), value: knownNumber(dynamics?.maxCorneringG) },
            ].map((metric) => (
              <div key={metric.label} className="flex min-w-0 flex-col items-center gap-1">
                {metric.value == null ? (
                  <WidgetBigNumber value={null} align="center" />
                ) : (
                  <WidgetGaugeHero
                    compact
                    gauge={{
                      value: metric.value,
                      max: G_MAX,
                      label: fmtNumber(metric.value, 2),
                      unit: '',
                      color: gaugeColor(metric.value),
                    }}
                  />
                )}
                <span className="text-xs text-[var(--text-secondary)]">{metric.label}</span>
              </div>
            ))}
          </div>

          {/* Severity label */}
          <div className="flex justify-center">
            {severity != null ? <Badge
              variant={severity === 'calm' || severity === 'normal' ? 'success' : 'warning'}
              size="sm"
            >
              {t(`widget.drivingDynamics.severity.${severity}`, { calm: 'Calm', normal: 'Normal', sporty: 'Sporty', aggressive: 'Aggressive' }[severity])}
            </Badge> : <Badge variant="neutral" size="sm">{t('widget.drivingDynamics.unknown', 'Unknown dynamics')}</Badge>}
          </div>

          {/* Wide: acceleration distribution histogram */}
          {isWide && (
            histogramData.length > 0 ? (
            <EmbeddedChart
              title={t('widget.drivingDynamics.distribution', 'G-force distribution')}
              ariaLabel={t(
                'widget.drivingDynamics.distributionAria',
                'Distribution of observed acceleration magnitudes',
              )}
              data={histogramData}
              dataColumns={[
                { key: 'range', label: t('widget.drivingDynamics.gForce', 'G-force') },
                { key: 'count', label: t('widget.drivingDynamics.samples', 'Samples') },
              ]}
              height={160}
              mobileHeight={144}
            >
              <p className="text-2xs text-[var(--text-muted)] mb-1">
                {t('widget.drivingDynamics.distribution', 'G-force distribution')}
              </p>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={histogramData} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                  {chartGrid}
                  <XAxis dataKey="range" tick={axisTickSm} />
                  <YAxis tick={axisTick} allowDecimals={false} />
                  <Tooltip
                    content={<ChartTooltip />}
                    labelFormatter={(v) => `${v}g`}
                  />
                  <Bar dataKey="count" fill={palette.series[0]} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </EmbeddedChart>
            ) : (
              <EmptyState
                /* no-action: distribution populates from observed acceleration samples. */
                icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
                message={distError
                  ? t('widget.drivingDynamics.distributionError', 'Acceleration distribution unavailable')
                  : distLoading
                    ? t('widget.drivingDynamics.distributionLoading', 'Loading acceleration distribution')
                    : t('widget.drivingDynamics.distributionEmpty', 'No acceleration samples yet')}
              />
            )
          )}
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Gauge className="h-5 w-5" />}
          message={t('widget.drivingDynamics.noData', 'No dynamics data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
