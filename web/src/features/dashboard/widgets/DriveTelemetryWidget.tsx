import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  chartGrid, axisTick, axisTickSm, chartAnimation, fmt, useThemeChartPalette,
  areaGradient,
} from '@/components/charts';
import { ChartTooltip } from '@/components/charts';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useDrives, useDriveTelemetry } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import type { WidgetProps } from './types';

interface ChartDatum {
  time: string;
  speed: number | null;
  power: number | null;
  battery: number | null;
  elevation: number | null;
}

export default function DriveTelemetryWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const { unitPrefs } = useUnits();
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  const {
    data: drives,
    isLoading: drivesLoading,
  } = useDrives(vid > 0 ? String(vid) : undefined);

  const latestDrive = useMemo(() => {
    const list = drives ?? [];
    if (list.length === 0) return null;
    return list.reduce((a, b) =>
      new Date(a.startTs) > new Date(b.startTs) ? a : b,
    );
  }, [drives]);

  const driveId = latestDrive ? String(latestDrive.id) : '';

  const {
    data: telemetry,
    isLoading: telemetryLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useDriveTelemetry(driveId);

  const isLoading = drivesLoading || telemetryLoading;
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  // Chart series colors derive from the active theme.
  const palette = useThemeChartPalette();

  const chartData = useMemo((): ChartDatum[] => {
    const points = telemetry ?? [];
    return points.map((p) => {
      const ts = new Date(p.timestamp);
      return {
        time: `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`,
        speed: p.speed != null ? convertSpeedFromSI(p.speed, unitPrefs.speed) : null,
        power: p.power ?? null,
        battery: p.batteryLevel ?? p.soc ?? null,
        elevation: p.elevation ?? null,
      };
    });
  }, [telemetry, unitPrefs.speed]);

  const stats = useMemo((): ChartSummaryStat[] => {
    if (!latestDrive) return [];
    const items: ChartSummaryStat[] = [
      {
        label: t('widget.driveTelemetry.distance', 'Distance'),
        value: fmtNumber(convertDistanceFromSI(latestDrive.distanceM, unitPrefs.distance), 1),
        unit: unitPrefs.distance,
      },
      {
        label: t('widget.driveTelemetry.duration', 'Duration'),
        value: fmtInt(latestDrive.durationS / 60),
        unit: t('widget.driveTelemetry.min', 'min'),
      },
    ];
    if (latestDrive.energyUsedWh != null && latestDrive.distanceM > 0) {
      const distance = convertDistanceFromSI(latestDrive.distanceM, unitPrefs.distance);
      const efficiency = distance > 0 ? latestDrive.energyUsedWh / distance : null;
      items.push({
        label: t('widget.driveTelemetry.efficiency', 'Efficiency'),
        value: efficiency != null ? fmtNumber(efficiency, 0) : '—',
        unit: efficiencyUnit,
      });
    }
    return items;
  }, [latestDrive, unitPrefs.distance, efficiencyUnit, t]);

  const tick = isWide ? axisTick : axisTickSm;

  const chart = useMemo(() => {
    if (chartData.length === 0) return null;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={chartData}
          margin={{ top: 4, right: 4, bottom: 0, left: isCompact ? -30 : -10 }}
          {...chartAnimation}
        >
          {areaGradient('power-pos', '#22c55e')}
          {areaGradient('power-neg', '#ef4444')}
          {areaGradient('elevation-grad', '#9ca3af')}
          {chartGrid}

          <XAxis
            dataKey="time"
            tick={isCompact ? false : tick}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />

          {/* Left axis: speed */}
          <YAxis
            yAxisId="speed"
            tick={isCompact ? false : tick}
            tickLine={false}
            axisLine={false}
            width={isCompact ? 0 : 36}
            domain={[0, 'dataMax + 10']}
            tickFormatter={(v: number) => fmt(v, 0)}
          />

          {/* Right axis: power */}
          <YAxis
            yAxisId="power"
            orientation="right"
            tick={isCompact ? false : tick}
            tickLine={false}
            axisLine={false}
            width={isCompact ? 0 : 36}
            tickFormatter={(v: number) => fmt(v, 0)}
          />

          <Tooltip content={<ChartTooltip />} />

          {/* Wide: elevation as gray area under speed */}
          {isWide && (
            <Area
              yAxisId="speed"
              dataKey="elevation"
              stroke="none"
              fill="url(#elevation-grad)"
              fillOpacity={0.15}
              name={t('widget.driveTelemetry.elevation', 'Elevation')}
              isAnimationActive={false}
              connectNulls
            />
          )}

          {/* Power as green/red area on right axis */}
          <Area
            yAxisId="power"
            dataKey="power"
            stroke={palette.series[1]}
            fill="url(#power-pos)"
            fillOpacity={0.3}
            strokeWidth={1.5}
            name={t('widget.driveTelemetry.power', 'Power (kW)')}
            connectNulls
          />

          {/* Speed as cyan line on left axis */}
          <Line
            yAxisId="speed"
            dataKey="speed"
            stroke={palette.series[0]}
            strokeWidth={2}
            dot={false}
            name={`${t('widget.driveTelemetry.speed', 'Speed')} (${unitPrefs.speed})`}
            connectNulls
          />

          {/* Battery % as amber dashed line on left axis (0-100 range fits well) */}
          <Line
            yAxisId="speed"
            dataKey="battery"
            stroke="#f59e0b"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            name={t('widget.driveTelemetry.battery', 'Battery %')}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    );
  }, [chartData, isCompact, isWide, tick, unitPrefs.speed, t, palette]);

  // Compact layout
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={error ? String(error) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}
      >
        <WidgetChartSummary
          stats={stats}
          chart={<></>}
          compact
          isEmpty={!latestDrive}
          emptyMessage={t('widget.driveTelemetry.empty', 'No recent drives')}
          emptyIcon={<Activity className="h-5 w-5" />}
        />
      </WidgetShell>
    );
  }

  // Standard / Wide layout
  return (
    <WidgetShell
      title={t('widget.driveTelemetry.title', 'Drive Telemetry')}
      icon={<Activity className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      error={error ? String(error) : null}
      noPadding
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {latestDrive ? (
        <div className="flex h-full flex-col px-4 pb-3">
          {/* Header stats + badges */}
          <div className="flex flex-wrap items-center gap-3 pb-2">
            {stats.map((s) => (
              <div key={s.label} className="flex flex-col">
                <span className="text-[10px] text-[var(--text-muted)]">{s.label}</span>
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  {s.value}
                  {s.unit && (
                    <span className="ml-0.5 text-[10px] font-normal text-[var(--text-muted)]">
                      {s.unit}
                    </span>
                  )}
                </span>
              </div>
            ))}
            {isWide && latestDrive.startAddress && (
              <Badge variant="neutral" size="sm" className="truncate max-w-[180px]">
                {latestDrive.startAddress}
              </Badge>
            )}
          </div>

          {/* Chart area */}
          <div className="flex-1 min-h-0">
            {chartData.length > 0 ? (
              chart
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Activity className="h-5 w-5" />}
                message={t('widget.driveTelemetry.noTelemetry', 'No telemetry for this drive')}
                className="py-4"
              />
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1 flex-shrink-0">
            <div className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: palette.series[0] }} />
              <span className="text-[10px] text-[var(--text-secondary)]">
                {t('widget.driveTelemetry.speed', 'Speed')}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: palette.series[1] }} />
              <span className="text-[10px] text-[var(--text-secondary)]">
                {t('widget.driveTelemetry.power', 'Power (kW)')}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: '#f59e0b' }} />
              <span className="text-[10px] text-[var(--text-secondary)]">
                {t('widget.driveTelemetry.battery', 'Battery %')}
              </span>
            </div>
            {isWide && (
              <div className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: '#9ca3af' }} />
                <span className="text-[10px] text-[var(--text-secondary)]">
                  {t('widget.driveTelemetry.elevation', 'Elevation')}
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Activity className="h-5 w-5" />}
          message={t('widget.driveTelemetry.empty', 'No recent drives')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
