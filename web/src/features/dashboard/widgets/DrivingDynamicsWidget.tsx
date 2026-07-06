import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { RadialGauge, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, axisTick, axisTickSm, chartGrid, useThemeChartPalette } from '@/components/charts';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useDrivingDynamics, useAccelerationDistribution } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
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

const SEVERITY_COLORS: Record<Severity, string> = {
  calm: '#10b981',
  normal: '#22d3ee',
  sporty: '#f59e0b',
  aggressive: '#ef4444',
};

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
    dataUpdatedAt: distUpdatedAt,
  } = useAccelerationDistribution(vehicleIdStr);

  const isLoading = dynLoading || distLoading;
  const updatedAt = Math.max(dynUpdatedAt ?? 0, distUpdatedAt ?? 0);
  const isFetching = dynFetching || distFetching;

  // Only replace the whole widget with a full-panel error on the INITIAL
  // load failure, when there is no cached data to fall back on. Once we have
  // data, a transient background-refetch failure must not blank out
  // otherwise-valid numbers — it is surfaced through the freshness
  // indicator's error state instead (WidgetShell forwards `isError` to
  // <DataFreshness>).
  const blockingError = !dynamics && dynError ? String(dynError) : null;

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  // Chart colors derive from the active theme.
  const palette = useThemeChartPalette();

  const maxG = Math.max(
    dynamics?.maxAccelerationG ?? 0,
    dynamics?.maxBrakingG ?? 0,
    dynamics?.maxCorneringG ?? 0,
  );
  const smooth = isSmooth(maxG);

  const severity = useMemo(
    () => deriveSeverity(dynamics?.avgAccelerationG ?? 0, dynamics?.avgBrakingG ?? 0),
    [dynamics?.avgAccelerationG, dynamics?.avgBrakingG],
  );

  const histogramData = useMemo(() => {
    const values = distData?.values ?? [];
    if (values.length === 0) return [];
    const step = G_MAX / values.length;
    return values.map((count, i) => ({
      range: `${fmtNumber(i * step, 2)}`,
      count: count ?? 0,
    }));
  }, [distData]);

  // Compact layout: large number + badge
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={blockingError}
        updatedAt={updatedAt}
        isFetching={isFetching}
        isStale={dynStale}
        isError={dynIsError}
        onRefresh={() => dynRefetch()}
      >
        {dynamics ? (
          <div className="h-full flex flex-col items-center justify-center gap-2">
            <span className="text-3xl font-bold text-[var(--text-primary)]">
              {fmtNumber(maxG, 2)}
            </span>
            <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
              {t('widget.drivingDynamics.maxG', 'Max g')}
            </span>
            <Badge
              variant={smooth ? 'success' : 'warning'}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              {smooth
                ? t('widget.drivingDynamics.smooth', 'Smooth')
                : t('widget.drivingDynamics.aggressive', 'Aggressive')}
            </Badge>
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
      title={t('widget.drivingDynamics.title', 'Driving Dynamics')}
      icon={<Gauge className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      error={blockingError}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={dynStale}
      isError={dynIsError}
      onRefresh={() => dynRefetch()}
    >
      {dynamics ? (
        <div className="h-full flex flex-col gap-3">
          {/* 3 RadialGauges */}
          <div className="flex items-center justify-around gap-2">
            <div className="flex flex-col items-center gap-1">
              <RadialGauge
                value={dynamics.avgAccelerationG ?? 0}
                max={G_MAX}
                label={fmtNumber(dynamics.avgAccelerationG ?? 0, 2)}
                color={gaugeColor(dynamics.avgAccelerationG ?? 0)}
                size={80}
              />
              <span className="text-2xs text-[var(--text-muted)]">
                {t('widget.drivingDynamics.accel', 'Accel')}
              </span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <RadialGauge
                value={dynamics.avgBrakingG ?? 0}
                max={G_MAX}
                label={fmtNumber(dynamics.avgBrakingG ?? 0, 2)}
                color={gaugeColor(dynamics.avgBrakingG ?? 0)}
                size={80}
              />
              <span className="text-2xs text-[var(--text-muted)]">
                {t('widget.drivingDynamics.brake', 'Brake')}
              </span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <RadialGauge
                value={dynamics.maxCorneringG ?? 0}
                max={G_MAX}
                label={fmtNumber(dynamics.maxCorneringG ?? 0, 2)}
                color={gaugeColor(dynamics.maxCorneringG ?? 0)}
                size={80}
              />
              <span className="text-2xs text-[var(--text-muted)]">
                {t('widget.drivingDynamics.lateral', 'Lateral')}
              </span>
            </div>
          </div>

          {/* Severity label */}
          <div className="flex justify-center">
            <Badge
              variant={severity === 'calm' || severity === 'normal' ? 'success' : 'warning'}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <span style={{ color: SEVERITY_COLORS[severity] }}>
                {t(`widget.drivingDynamics.severity.${severity}`, severity.charAt(0).toUpperCase() + severity.slice(1))}
              </span>
            </Badge>
          </div>

          {/* Wide: acceleration distribution histogram */}
          {isWide && histogramData.length > 0 && (
            <div className="flex-1 min-h-0">
              <p className="text-2xs text-[var(--text-muted)] mb-1">
                {t('widget.drivingDynamics.distribution', 'G-Force Distribution')}
              </p>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={histogramData} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                  {chartGrid}
                  <XAxis dataKey="range" tick={axisTickSm} />
                  <YAxis tick={axisTick} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                    labelFormatter={(v) => `${v}g`}
                  />
                  <Bar dataKey="count" fill={palette.series[0]} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
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
