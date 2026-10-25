import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, chartGrid, chartAnimation, axisTickSm, useMeasuredAxisWidth, useThemeChartPalette, EmbeddedChart, ChartLegend, type ChartDataRow } from '@/components/charts';
import { ChartTooltip } from '@/components/charts';
import { EmptyState, Skeleton } from '@/components/feedback';
import { SourceContent } from '@/components/layout';
import { VisuallyHidden } from '@/components/a11y';
import { useDrives, useDriveTelemetry } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { convertSpeedFromSI, convertPowerFromSI } from '@/lib/unitConversion';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

import { WidgetShell } from './WidgetShell';
import { WidgetChartSummary } from './shared';
import { knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { useDataState } from '@/hooks/useDataState';
import type { WidgetProps } from './types';
import { sourceBoundaryState } from '../components/continuation-dashboard-1/sourceBoundary';

interface ChartDatum extends ChartDataRow {
  time: string;
  speed: number | null;
  power: number | null;
}

export default function DriveTelemetryWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatTime } = useDateFormat();
  const { fmtNumber } = useNumberFormatting();
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const { unitPrefs } = useUnits();

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
  const telemetryTrust = useDataState({
    data: telemetry, isLoading: telemetryLoading, error, isError, isFetching, dataUpdatedAt, refetch,
  }, { provenance: 'historical' });
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
      const convertedSpeed = speed != null ? convertSpeedFromSI(speed, unitPrefs.speed) : null;
      const convertedPower = power != null
        ? convertPowerFromSI(power, unitPrefs.power ?? 'kW')
        : null;
      return {
        time: Number.isNaN(ts.getTime()) ? '—' : formatTime(ts),
        speed: convertedSpeed != null && Number.isFinite(convertedSpeed)
          ? Math.round(convertedSpeed)
          : null,
        power: convertedPower != null && Number.isFinite(convertedPower)
          ? (unitPrefs.power ?? 'kW') === 'kW'
            ? Math.round(convertedPower * 10) / 10
            : Math.round(convertedPower)
          : null,
      };
    });
  }, [telemetry, unitPrefs.speed, unitPrefs.power, formatTime]);

  const axisLabels = useMemo(() => [0, ...chartData.flatMap(point => [point.speed, point.power])]
    .filter((value): value is number => value != null)
    .map(value => fmtNumber(value, 0)), [chartData, fmtNumber]);
  const axisWidth = useMeasuredAxisWidth({
    labels: axisLabels, fontSize: 10, minWidth: 40, padding: 20, enabled: !isCompact,
  });
  const lastPoint = chartData[chartData.length - 1];
  const compactStats = [
    {
      label: t('widget.driveTelemetry.speed', 'Speed'),
      value: lastPoint?.speed == null ? null : fmtNumber(lastPoint.speed, 0),
      unit: unitPrefs.speed,
    },
    {
      label: t('widget.driveTelemetry.powerLabel', 'Power'),
      value: lastPoint?.power == null ? null : fmtNumber(lastPoint.power, (unitPrefs.power ?? 'kW') === 'kW' ? 1 : 0),
      unit: unitPrefs.power ?? 'kW',
    },
  ];
  const telemetrySourceProps = {
    state: sourceBoundaryState(telemetryTrust, chartData.length > 0),
    label: t('widget.driveTelemetry.title', 'Drive telemetry'),
    emptyMessage: t('widget.driveTelemetry.noTelemetry', 'No telemetry for this drive'),
    loadingContent: <div className="flex h-full min-h-0 flex-col gap-2">
      <Skeleton className="min-h-8 flex-1" />
      <VisuallyHidden>{t('widget.driveTelemetry.telemetryLoading', 'Loading drive telemetry')}</VisuallyHidden>
    </div>,
    errorMessage: t('widget.driveTelemetry.telemetryError', 'Drive telemetry unavailable'),
    error: telemetryTrust.fatalError,
    retainedMessage: t('widget.driveTelemetry.telemetryRetained', 'Previously loaded drive telemetry remains visible while this source recovers.'),
    errorRecovery: { onRetry: () => { void refetch(); } },
  };

  const chart = useMemo(() => {
    if (chartData.length === 0) return null;
    return (
      <EmbeddedChart
        className="h-full min-h-0"
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
        ]}
        chartKey="dashboard-drive-telemetry"
      >
        {({ hiddenSeries }) => (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }} {...chartAnimation}>
          {chartGrid}
          <XAxis
            dataKey="time"
            hide={isCompact}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="speed"
            tick={axisTickSm}
            width={axisWidth}
            tickFormatter={(value: number) => fmtNumber(value, 0)}
            tickLine={false}
            axisLine={false}
            domain={[0, 'dataMax + 10']}
          />
          <YAxis
            yAxisId="power"
            orientation="right"
            tick={axisTickSm}
            width={axisWidth}
            tickFormatter={(value: number) => fmtNumber(value, 0)}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<ChartTooltip />} />
          <ChartLegend />
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
          <Line
            yAxisId="power"
            dataKey="power"
            stroke={palette.series[1]}
            strokeWidth={1.5}
            dot={false}
            name={`${t('widget.driveTelemetry.powerLabel', 'Power')} (${unitPrefs.power ?? 'kW'})`}
            connectNulls={false}
            hide={hiddenSeries?.isHidden('power')}
          />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </EmbeddedChart>
    );
  }, [chartData, isCompact, unitPrefs.speed, unitPrefs.power, t, palette, axisWidth, fmtNumber]);

  // Compact layout
  if (isCompact) {
    const summary = (
      <WidgetChartSummary
        stats={compactStats}
        chart={null}
        compact
        isEmpty={!latestDrive}
        emptyMessage={t('widget.driveTelemetry.empty', 'No recent drives')}
        emptyIcon={<Activity className="h-5 w-5" />}
      />
    );
    return (
      <WidgetShell
        title={t('widget.driveTelemetry.title', 'Drive telemetry')}
        loading={isLoading}
        dataState={trust.hasData ? trust : undefined}
        error={trust.fatalError?.message ?? null}
        updatedAt={combinedUpdatedAt}
        isFetching={combinedIsFetching}
        isStale={isStale}
        isError={combinedIsError}
        onRefresh={handleRefresh}
      >
        {latestDrive ? <SourceContent {...telemetrySourceProps}>{summary}</SourceContent> : summary}
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
      description={undefined}
      updatedAt={combinedUpdatedAt}
      isFetching={combinedIsFetching}
      isStale={isStale}
      isError={combinedIsError}
      onRefresh={handleRefresh}
    >
      {latestDrive ? (
        <div className="flex h-full min-h-0 flex-col">
          <p className="shrink-0 break-words px-0 pb-1 text-sm text-[var(--text-secondary)]">
            {t('widget.driveTelemetry.lastDrive', 'Last drive')}
            {latestDrive.startAddress && ` · ${latestDrive.startAddress}`}
            {latestDrive.endAddress && ` → ${latestDrive.endAddress}`}
          </p>

          {/* Chart area */}
          <div className="flex min-h-0 flex-1 flex-col">
            <SourceContent {...telemetrySourceProps}>
              <WidgetChartSummary
                stats={[]}
                chart={chart}
              />
            </SourceContent>
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
