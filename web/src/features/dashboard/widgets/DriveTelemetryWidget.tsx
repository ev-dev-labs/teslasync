import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, chartGrid, axisTick, axisTickSm, chartAnimation, useThemeChartPalette, areaGradient, ChartLegend, EmbeddedChart, type ChartDataRow } from '@/components/charts';
import { ChartTooltip } from '@/components/charts';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useDrives, useDriveTelemetry } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertSpeedFromSI, convertPowerFromSI } from '@/lib/unitConversion';

import { WidgetShell } from './WidgetShell';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { useDataState } from '@/hooks/useDataState';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface ChartDatum extends ChartDataRow {
  time: string;
  speed: number | null;
  power: number | null;
  battery: number | null;
  elevation: number | null;
}

export default function DriveTelemetryWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber: fmt } = useNumberFormatting();
  const { fmtNumber, fmtInt } = useNumberFormatting();
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
    const list = safeArray(drives);
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

  const isLoading = !drives && drivesLoading;
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
  const trust = useDataState({
    data: drives,
    error: combinedError,
    isError: combinedIsError,
    isFetching: combinedIsFetching,
    dataUpdatedAt: combinedUpdatedAt,
  }, { provenance: 'historical', partial: Boolean(latestDrive && !telemetry) });
  const handleRefresh = useCallback(() => {
    refetchDrives();
    refetch();
  }, [refetchDrives, refetch]);

  // Chart series colors derive from the active theme.
  const palette = useThemeChartPalette();

  const chartData = useMemo((): ChartDatum[] => {
    const points = safeArray(telemetry);
    return points.map((p) => {
      const ts = new Date(p.timestamp);
      const speed = knownNumber(p.speed);
      const power = knownNumber(p.power);
      const elevation = knownNumber(p.elevation);
      return {
        time: Number.isNaN(ts.getTime()) ? '—' : `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`,
        speed: speed != null ? convertSpeedFromSI(speed, unitPrefs.speed) : null,
        power: power != null ? convertPowerFromSI(power, unitPrefs.power ?? 'kW') : null,
        battery: knownNumber(p.batteryLevel) ?? knownNumber(p.soc),
        elevation: elevation != null ? convertDistanceFromSI(elevation, unitPrefs.distance) : null,
      };
    });
  }, [telemetry, unitPrefs.speed, unitPrefs.power, unitPrefs.distance]);

  const stats = useMemo((): ChartSummaryStat[] => {
    if (!latestDrive) return [];
    const items: ChartSummaryStat[] = [
      {
        label: t('widget.driveTelemetry.distance', 'Distance'),
        value: knownNumber(latestDrive.distanceM) == null ? null : fmtNumber(convertDistanceFromSI(latestDrive.distanceM, unitPrefs.distance)),
        unit: unitPrefs.distance,
      },
      {
        label: t('widget.driveTelemetry.duration', 'Duration'),
        value: knownNumber(latestDrive.durationS) == null ? null : fmtInt(latestDrive.durationS / 60),
        unit: t('widget.driveTelemetry.min', 'min'),
      },
    ];
    const energy = knownNumber(latestDrive.energyUsedWh);
    const distanceM = knownNumber(latestDrive.distanceM);
    if (energy != null && distanceM != null && distanceM > 0) {
      const distance = convertDistanceFromSI(latestDrive.distanceM, unitPrefs.distance);
      const efficiency = distance > 0 ? energy / distance : null;
      items.push({
        label: t('widget.driveTelemetry.efficiency', 'Efficiency'),
        value: efficiency != null ? fmtNumber(efficiency) : '—',
        unit: efficiencyUnit,
      });
    }
    return items;
  }, [latestDrive, unitPrefs.distance, efficiencyUnit, t, fmtNumber, fmtInt]);

  const tick = isWide ? axisTick : axisTickSm;

  const chart = useMemo(() => {
    if (chartData.length === 0) return null;
    return (
      <EmbeddedChart
        height={180}
        mobileHeight={160}
        title={t('widget.driveTelemetry.title', 'Drive telemetry')}
        ariaLabel={t(
          'widget.driveTelemetry.chartAria',
          'Speed, power, battery, and elevation during the latest drive',
        )}
        data={chartData}
        dataColumns={[
          { key: 'time', label: t('widget.driveTelemetry.time', 'Time') },
          { key: 'speed', label: `${t('widget.driveTelemetry.speed', 'Speed')} (${unitPrefs.speed})` },
          { key: 'power', label: `${t('widget.driveTelemetry.powerLabel', 'Power')} (${unitPrefs.power ?? 'kW'})` },
          { key: 'battery', label: t('widget.driveTelemetry.battery', 'Battery %') },
          { key: 'elevation', label: `${t('widget.driveTelemetry.elevation', 'Elevation')} (${unitPrefs.distance})` },
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
          {areaGradient('power-pos', palette.series[1])}
          {areaGradient('elevation-grad', palette.series[3])}
          {chartGrid}

          <XAxis
            dataKey="time"
            tick={isCompact ? false : tick}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis yAxisId="battery" hide domain={[0, 100]} />
          <YAxis yAxisId="elevation" hide domain={['dataMin', 'dataMax']} />

          {/* Left axis: speed */}
          <YAxis
            yAxisId="speed"
            tick={isCompact ? false : tick}
            tickLine={false}
            axisLine={false}
            width={isCompact ? 0 : 36}
            domain={[0, 'dataMax + 10']}
            tickFormatter={(v: number) => fmt(v)}
          />

          {/* Right axis: power */}
          <YAxis
            yAxisId="power"
            orientation="right"
            tick={isCompact ? false : tick}
            tickLine={false}
            axisLine={false}
            width={isCompact ? 0 : 36}
            tickFormatter={(v: number) => fmt(v)}
          />

          <Tooltip content={<ChartTooltip />} />
          <ChartLegend />

          {/* Wide: elevation as gray area under speed */}
          {isWide && (
            <Area
              yAxisId="elevation"
              dataKey="elevation"
              stroke="none"
              fill="url(#elevation-grad)"
              fillOpacity={0.15}
              name={`${t('widget.driveTelemetry.elevation', 'Elevation')} (${unitPrefs.distance})`}
              isAnimationActive={false}
              connectNulls={false}
              hide={hiddenSeries?.isHidden('elevation')}
            />
          )}

          {/* Signed power is rendered without inventing an energy total. */}
          <Area
            yAxisId="power"
            dataKey="power"
            stroke={palette.series[1]}
            fill="url(#power-pos)"
            fillOpacity={0.3}
            strokeWidth={1.5}
            name={`${t('widget.driveTelemetry.powerLabel', 'Power')} (${unitPrefs.power ?? 'kW'})`}
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

          {/* Battery has its own percentage scale, independent of speed. */}
          <Line
            yAxisId="battery"
            dataKey="battery"
            stroke={palette.series[2]}
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
  }, [chartData, isCompact, isWide, tick, unitPrefs.speed, unitPrefs.power, unitPrefs.distance, t, palette, fmt]);

  // Compact layout
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        dataState={trust.hasData ? trust : undefined}
        error={trust.fatalError?.message ?? null}
        updatedAt={combinedUpdatedAt}
        isFetching={combinedIsFetching}
        isStale={isStale}
        isError={combinedIsError}
        onRefresh={handleRefresh}
      >
        <WidgetChartSummary
          stats={stats}
          chart={null}
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
      title={t('widget.driveTelemetry.title', 'Drive telemetry')}
      icon={<Activity className="h-3.5 w-3.5" aria-hidden="true" />}
      loading={isLoading}
      dataState={trust.hasData ? trust : undefined}
      error={trust.fatalError?.message ?? null}
      description={t('widget.driveTelemetry.sampleScope', 'Latest drive · recorded samples may contain gaps')}
      updatedAt={combinedUpdatedAt}
      isFetching={combinedIsFetching}
      isStale={isStale}
      isError={combinedIsError}
      onRefresh={handleRefresh}
    >
      {latestDrive ? (
        <div className="flex min-h-full flex-col">
          {/* Header stats + badges */}
          <div className="flex flex-wrap items-center gap-3 pb-2">
            <WidgetChartSummary stats={stats} chart={null} compact />
            {isWide && latestDrive.startAddress && (
              <Badge variant="neutral" size="sm" className="truncate max-w-[180px]">
                {latestDrive.startAddress}
              </Badge>
            )}
          </div>

          {/* Chart area */}
          <div className="flex-1 min-h-40">
            {chartData.length > 0 ? (
              chart
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Activity className="h-5 w-5" />}
                message={telemetryLoading
                  ? t('widget.driveTelemetry.telemetryLoading', 'Loading drive telemetry')
                  : error
                    ? t('widget.driveTelemetry.telemetryError', 'Drive telemetry unavailable')
                    : t('widget.driveTelemetry.noTelemetry', 'No telemetry for this drive')}
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
