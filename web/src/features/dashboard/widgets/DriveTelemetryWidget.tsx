import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  chartGrid, axisTick, axisTickSm, chartAnimation, fmt, useThemeChartPalette,
  areaGradient,
  ChartLegend, EmbeddedChart, type ChartDataRow,
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

interface ChartDatum extends ChartDataRow {
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
    error: drivesError,
    isError: drivesIsError,
    isFetching: drivesFetching,
    dataUpdatedAt: drivesUpdatedAt,
    refetch: refetchDrives,
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

  // Surface failures from BOTH data sources. A `/drives` fetch error used to be
  // swallowed (only its loading flag was read) and rendered as the "No recent
  // drives" empty state, masking an outage as "no data". Fold the drives +
  // telemetry error / freshness signals together so the shell shows a real
  // error and the refresh control retries whichever query failed.
  const combinedError = drivesError ?? error;
  const combinedIsError = drivesIsError || isError;
  const combinedIsFetching = drivesFetching || isFetching;
  const combinedUpdatedAt = Math.max(dataUpdatedAt ?? 0, drivesUpdatedAt ?? 0);
  const handleRefresh = useCallback(() => {
    refetchDrives();
    refetch();
  }, [refetchDrives, refetch]);

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
        value: fmtNumber(convertDistanceFromSI(latestDrive.distanceM ?? 0, unitPrefs.distance), 1),
        unit: unitPrefs.distance,
      },
      {
        label: t('widget.driveTelemetry.duration', 'Duration'),
        value: fmtInt((latestDrive.durationS ?? 0) / 60),
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
      <EmbeddedChart
        title={t('widget.driveTelemetry.title', 'Drive Telemetry')}
        ariaLabel={t(
          'widget.driveTelemetry.chartAria',
          'Speed, power, battery, and elevation during the latest drive',
        )}
        data={chartData}
        dataColumns={[
          { key: 'time', label: t('widget.driveTelemetry.time', 'Time') },
          { key: 'speed', label: `${t('widget.driveTelemetry.speed', 'Speed')} (${unitPrefs.speed})` },
          { key: 'power', label: t('widget.driveTelemetry.power', 'Power (kW)') },
          { key: 'battery', label: t('widget.driveTelemetry.battery', 'Battery %') },
          { key: 'elevation', label: t('widget.driveTelemetry.elevation', 'Elevation') },
        ]}
        chartKey="dashboard-drive-telemetry"
      >
        {({ hiddenSeries }) => (
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
          <ChartLegend />

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
              connectNulls={false}
              hide={hiddenSeries?.isHidden('elevation')}
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
            connectNulls={false}
            hide={hiddenSeries?.isHidden('power')}
          />

          {/* Speed as cyan line on left axis */}
          <Line
            yAxisId="speed"
            dataKey="speed"
            stroke={palette.series[0]}
            strokeWidth={2}
            dot={false}
            name={`${t('widget.driveTelemetry.speed', 'Speed')} (${unitPrefs.speed})`}
            connectNulls={false}
            hide={hiddenSeries?.isHidden('speed')}
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
            connectNulls={false}
            hide={hiddenSeries?.isHidden('battery')}
          />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </EmbeddedChart>
    );
  }, [chartData, isCompact, isWide, tick, unitPrefs.speed, t, palette]);

  // Compact layout
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={combinedError ? String(combinedError) : null}
        updatedAt={combinedUpdatedAt}
        isFetching={combinedIsFetching}
        isStale={isStale}
        isError={combinedIsError}
        onRefresh={handleRefresh}
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
      error={combinedError ? String(combinedError) : null}
      noPadding
      updatedAt={combinedUpdatedAt}
      isFetching={combinedIsFetching}
      isStale={isStale}
      isError={combinedIsError}
      onRefresh={handleRefresh}
    >
      {latestDrive ? (
        <div className="flex h-full flex-col px-4 pb-3">
          {/* Header stats + badges */}
          <div className="flex flex-wrap items-center gap-3 pb-2">
            {stats.map((s) => (
              <div key={s.label} className="flex flex-col">
                <span className="text-2xs text-[var(--text-muted)]">{s.label}</span>
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  {s.value}
                  {s.unit && (
                    <span className="ml-0.5 text-2xs font-normal text-[var(--text-muted)]">
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
