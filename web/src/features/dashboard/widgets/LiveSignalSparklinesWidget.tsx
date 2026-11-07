import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { EmbeddedChart, Line, LineChart, Sparkline, XAxis, YAxis } from '@/components/charts';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Caption, Text } from '@/components/ui';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSignals, useSignalGaps, useSignalHistory } from '@/api/hooks/useTelemetry';

import { CHART_COLORS } from '@/lib/colors';
import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { usePackPresentation } from './designPacks/PackBoundary';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';
import {
  convertDistanceFromSI,
  convertSpeedFromSI,
  convertTempFromSI,
} from '@/lib/unitConversion';
import { useDataState, useCombinedDataState } from '@/hooks/useDataState';
import { dashboardTokens } from '../lib/dashboardTokens';
import { cn } from '@/lib/cn';

const DEFAULT_SIGNALS = [
  'BatteryLevel',
  'VehicleSpeed',
  'OutsideTemp',
  'InsideTemp',
  'Odometer',
  'PackCurrent',
];

// Categorical signals need distinct teal/violet/amber/green/blue/rose marks,
// not vehicle-state colors that may resolve to the same blue.
export const SIGNAL_COLORS = [
  CHART_COLORS[1],
  CHART_COLORS[6],
  CHART_COLORS[3],
  CHART_COLORS[2],
  CHART_COLORS[0],
  CHART_COLORS[5],
];

/** Pretty-print a PascalCase signal name as spaced words */
export function formatSignalName(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

/** Extract numeric value from a live signal entry */
export function extractNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && isFinite(value)) return value;
  if (typeof value === 'string') {
    if (value.trim() === '') return null;
    const n = Number(value);
    if (isFinite(n)) return n;
  }
  return null;
}

export type SignalDisplayKind = 'percent' | 'speed' | 'temperature' | 'distance' | 'current' | 'number';

export function getSignalDisplayKind(signal: string): SignalDisplayKind {
  if (signal === 'BatteryLevel') return 'percent';
  if (signal === 'VehicleSpeed' || signal.toLowerCase().includes('speed')) return 'speed';
  if (signal === 'OutsideTemp' || signal === 'InsideTemp' || signal.toLowerCase().includes('temp')) return 'temperature';
  if (signal === 'Odometer' || signal.toLowerCase().includes('odometer') || signal.toLowerCase().includes('distance')) return 'distance';
  if (signal === 'PackCurrent' || signal.toLowerCase().includes('current')) return 'current';
  return 'number';
}

interface SignalRowProps {
  vehicleId: number;
  signal: string;
  liveValue: unknown;
  color: string;
  isWide: boolean;
}

function SignalSparklineRow({ vehicleId, signal, liveValue, color, isWide }: SignalRowProps) {
  const packId = usePackPresentation();
  const { fmtNumber } = useNumberFormatting();
  const { unitPrefs, formatSpeed, formatTemperature, formatDistance } = useUnits();
  const historyQuery = useSignalHistory(vehicleId, encodeURIComponent(signal), 1);
  const { data: history } = historyQuery;
  const historyState = useDataState({
    ...historyQuery,
    data: historyQuery.isError && (!Array.isArray(history?.data) || history.data.length === 0) ? undefined : history,
  }, { provenance: 'historical' });
  const { t } = useTranslation('dashboard');

  const historyPoints = useMemo(() => {
    const points = Array.isArray(history?.data) ? history.data : [];
    const kind = getSignalDisplayKind(signal);
    return points.map((point, sample) => {
      const raw = point?.value;
      let value = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
      if (value != null) {
        if (kind === 'speed') value = convertSpeedFromSI(value, unitPrefs.speed);
        if (kind === 'temperature') value = convertTempFromSI(value, unitPrefs.temperature);
        if (kind === 'distance') value = convertDistanceFromSI(value, unitPrefs.distance);
      }
      if (value != null && !Number.isFinite(value)) value = null;
      return { sample, timestamp: point?.ts, value };
    });
  }, [history, signal, unitPrefs.speed, unitPrefs.temperature, unitPrefs.distance]);
  const numericPoints = useMemo(
    () => historyPoints.map(point => point.value).filter((value): value is number => value != null),
    [historyPoints],
  );
  const hasGaps = historyPoints.some(point => point.value == null);
  const samples = useMemo(() => historyPoints.map(point => ({
    timestamp: typeof point.timestamp === 'string' ? Date.parse(point.timestamp) : Number.NaN,
    value: point.value,
  })), [historyPoints]);

  const currentValue = extractNumericValue(liveValue);
  const hasSparkline = (packId === 'classic' ? numericPoints.length
    : samples.filter(point => Number.isFinite(point.timestamp) && point.value != null).length) >= 2;

  // Trend: compare first quarter average to last quarter average
  const trend = useMemo(() => {
    if (numericPoints.length < 4) return 'flat' as const;
    const quarter = Math.max(1, Math.floor(numericPoints.length / 4));
    const earlyAvg = numericPoints.slice(0, quarter).reduce((a, b) => a + b, 0) / quarter;
    const lateAvg = numericPoints.slice(-quarter).reduce((a, b) => a + b, 0) / quarter;
    const delta = lateAvg - earlyAvg;
    const threshold = Math.abs(earlyAvg) * 0.01 || 0.1;
    if (delta > threshold) return 'up' as const;
    if (delta < -threshold) return 'down' as const;
    return 'flat' as const;
  }, [numericPoints]);

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendLabel =
    trend === 'up'
      ? t('widget.trendUp', 'Trending up')
      : trend === 'down'
        ? t('widget.trendDown', 'Trending down')
        : t('widget.trendFlat', 'No change');

  const label = formatSignalName(signal);
  const kind = getSignalDisplayKind(signal);
  const formattedValue = useMemo(() => {
    if (currentValue == null) return null;
    if (kind === 'percent') return `${fmtNumber(currentValue, 1)}%`;
    if (kind === 'speed') return formatSpeed(currentValue, { precision: 1 });
    if (kind === 'temperature') return formatTemperature(currentValue, { precision: 1 });
    if (kind === 'distance') return formatDistance(currentValue, { precision: 1 });
    if (kind === 'current') return `${fmtNumber(currentValue, 1)} A`;
    return fmtNumber(currentValue);
  }, [currentValue, fmtNumber, formatDistance, formatSpeed, formatTemperature, kind]);

  const headline = (
    <div className="min-w-0">
      <Caption className="block truncate" title={label}>
        {label}
      </Caption>
      <Text as="p" size="lg" weight="semibold" color="primary" className="truncate tabular-nums" title={formattedValue ?? undefined}>
        {formattedValue ?? '—'}
      </Text>
    </div>
  );
  const sparklineLabel = `${label} ${t('widget.trendSparkline', 'trend')}`;
  const chartWidth = isWide ? 80 : 56;
  const displayUnit = kind === 'percent' ? '%' : kind === 'speed' ? unitPrefs.speed
    : kind === 'temperature' ? unitPrefs.temperature : kind === 'distance' ? unitPrefs.distance
      : kind === 'current' ? 'A' : '';
  const sparkline = <Sparkline
    {...(packId === 'classic' ? { data: numericPoints } : { samples })}
    color={color} width={chartWidth} height={20} ariaLabel={sparklineLabel}
  />;
  const instrument = !historyState.fatalError && (historyQuery.isLoading && !hasSparkline ? (
    <div role="status" aria-label={t('dashboardWidgets.telemetry.signalHistoryLoading', 'Loading signal history')}>
      <Skeleton className="h-5 w-14" />
    </div>
  ) : hasSparkline ? (
    hasGaps ? (
      <EmbeddedChart title={sparklineLabel} ariaLabel={sparklineLabel} height={20} mobileHeight={20}
        toolbar={false} className="min-w-0 max-w-full" viewportClassName="min-h-0 overflow-hidden"
        data={historyPoints} dataColumns={[
          { key: 'timestamp', label: t('dashboardWidgets.telemetry.signalHistoryTime', 'Sample time') },
          { key: 'value', label: displayUnit ? `${label} (${displayUnit})` : label, format: value => value == null ? '—' : fmtNumber(value, 1) },
        ]}>
        {packId === 'classic' ? <LineChart width={chartWidth} height={20} data={historyPoints} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} accessibilityLayer={false}>
          <XAxis dataKey="sample" type="number" domain={['dataMin', 'dataMax']} hide />
          <YAxis type="number" domain={['dataMin', 'dataMax']} hide />
          <Line dataKey="value" type="linear" stroke={color} strokeWidth={1.5}
            connectNulls={false} dot={{ r: 1.5 }} activeDot={false} isAnimationActive={false} />
        </LineChart> : <div aria-hidden="true">{sparkline}</div>}
      </EmbeddedChart>
    ) : (
      sparkline
    )
  ) : (
    <Caption className="w-14 break-words text-center">
      {t('widget.noHistory', 'no data')}
    </Caption>
  ));
  const trendIndicator = (
    <span role="img" aria-label={numericPoints.length >= 4 ? trendLabel : t('widget.noHistory', 'no data')} className="col-start-3 row-start-1 flex-shrink-0">
      <TrendIcon className={cn(
        'h-3.5 w-3.5',
        trend === 'up' && 'text-emerald-300',
        trend === 'down' && 'text-rose-300',
        trend === 'flat' && 'text-[var(--text-muted)]',
      )} aria-hidden="true" />
    </span>
  );
  const recovery = (
    <>
      {historyState.fatalError && (
        <div className="col-span-full min-w-0">
          <QueryError error={historyState.fatalError} onRetry={() => { void historyQuery.refetch(); }} />
        </div>
      )}
      <StaleRefreshWarning state={historyState} className="col-span-full w-full min-w-0" />
    </>
  );

  return (
    <InstrumentPresentation family="line" compact={!isWide} headline={headline}
      icon={<Activity />} instrument={instrument} context={recovery}
      details={<div className="flex min-w-0 items-center gap-2">
        {trendIndicator}
        <Caption>{numericPoints.length >= 4 ? trendLabel : t('widget.noHistory', 'no data')}</Caption>
      </div>}>
      <div className={cn(
        'grid min-w-0 items-center border-b border-[var(--border-subtle)] py-2 last:border-b-0',
        isWide ? 'grid-cols-[minmax(0,1fr)_minmax(56px,80px)_16px]' : 'grid-cols-[minmax(0,1fr)_56px_16px]',
        'gap-2.5',
      )}>
        {headline}
        {instrument}
        {trendIndicator}
        {recovery}
      </div>
    </InstrumentPresentation>
  );
}

export default function LiveSignalSparklinesWidget({ vehicleId, config, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const signalsQuery = useSignals(id);
  const liveQuery = useSignalGaps(id);
  const { data: availableSignals, isLoading: signalsLoading } = signalsQuery;
  const { data: liveData, isLoading: liveLoading, isFetching: liveFetching, isStale: liveStale, isError: liveError, dataUpdatedAt: liveUpdatedAt, refetch: refetchLive } = liveQuery;
  const signalsState = useDataState({
    ...signalsQuery,
    data: signalsQuery.isError && (!Array.isArray(availableSignals) || availableSignals.length === 0) ? undefined : availableSignals,
  });
  const liveState = useDataState({
    ...liveQuery,
    data: liveError && (!liveData || Object.keys(liveData).length === 0) ? undefined : liveData,
  });
  const dataState = useCombinedDataState([signalsState, liveState]);
  const handleRefresh = () => {
    void refetchLive();
    void signalsQuery.refetch();
  };

  const isLoading = signalsLoading || liveLoading;

  // Safely extract configured signals, intersect with available
  const configuredSignals = useMemo(() => {
    if (Array.isArray(config?.signals) && config.signals.length === 0) return [];
    const raw = Array.isArray(config?.signals)
      ? (config.signals as unknown[]).filter((s): s is string => typeof s === 'string')
      : DEFAULT_SIGNALS;

    const available = new Set(Array.isArray(availableSignals) ? availableSignals.filter((s) => typeof s === 'string') : []);
    if (available.size === 0) return raw.slice(0, 6);

    const filtered = raw.filter((s) => available.has(s));
    // If none of the configured signals are available, pick the first 6 available
    if (filtered.length === 0) {
      return Array.from(available).slice(0, 6);
    }
    return filtered.slice(0, 6);
  }, [config?.signals, availableSignals]);

  const isWide = size.cols >= 3;
  const useTwoColumns = size.cols >= 3 && configuredSignals.length > 3;

  return (
    <WidgetShell
      title={t('widget.liveSparklines', 'Live signal sparklines')}
      icon={<Activity className="h-3.5 w-3.5 text-theme-accent" />}
      loading={isLoading}
      dataState={{
        ...dataState, retry: handleRefresh, data: liveData ?? availableSignals,
        hasData: liveData != null || availableSignals != null,
        fatalError: signalsState.hasData || liveState.hasData ? null : signalsState.fatalError ?? liveState.fatalError,
        status: id <= 0 ? 'unavailable' : dataState.status,
      }}
      updatedAt={liveUpdatedAt}
      isFetching={liveFetching}
      isStale={liveStale}
      isError={liveError}
      onRefresh={handleRefresh}
    >
      {signalsState.fatalError && (
        <div className="mb-2 min-w-0">
          <Caption className="block break-words">{t('widget.signalHealth.sourceCatalog', 'Signal catalog')}</Caption>
          <QueryError error={signalsState.fatalError} onRetry={signalsState.retry ?? undefined} />
        </div>
      )}
      {liveState.fatalError && (
        <div className="mb-2 min-w-0">
          <Caption className="block break-words">{t('widget.signalHealth.sourceLive', 'Live signals')}</Caption>
          <QueryError error={liveState.fatalError} onRetry={liveState.retry ?? undefined} />
        </div>
      )}
      {configuredSignals.length === 0 ? (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Activity className="h-5 w-5" />}
          message={t('widget.noSignalsAvailable', 'No signals available')}
          className="py-4"
        />
      ) : (
        <div className={useTwoColumns ? `grid ${dashboardTokens.columns[2]} gap-x-4` : undefined}>
          {configuredSignals.map((signal, i) => (
            <SignalSparklineRow
              key={signal}
              vehicleId={id}
              signal={signal}
              liveValue={liveData?.[signal]?.value}
              color={SIGNAL_COLORS[i % SIGNAL_COLORS.length]}
              isWide={isWide}
            />
          ))}
        </div>
      )}
    </WidgetShell>
  );
}
