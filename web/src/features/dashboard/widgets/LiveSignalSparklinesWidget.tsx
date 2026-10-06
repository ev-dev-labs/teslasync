import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Sparkline } from '@/components/charts';
import { EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { Caption, Text } from '@/components/ui';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSignals, useSignalGaps, useSignalHistory } from '@/api/hooks/useTelemetry';

import { NEON_COLORS } from '@/components/charts';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState, useCombinedDataState } from '@/hooks/useDataState';
import { dashboardTokens } from '../lib/dashboardTokens';

const DEFAULT_SIGNALS = [
  'BatteryLevel',
  'VehicleSpeed',
  'OutsideTemp',
  'InsideTemp',
  'Odometer',
  'PackCurrent',
];

// Six visually distinct series colours. NEON_COLORS is [cyan, emerald, purple,
// amber, indigo, red, …]; index directly so the assignments match the comments
// (previously NEON_COLORS[1]/[2] were mislabelled "purple"/"amber", which made
// index 1 and index 3 both resolve to emerald `#10b981` — a duplicate colour).
export const SIGNAL_COLORS = [
  NEON_COLORS[0], // cyan    (#00f0ff)
  NEON_COLORS[2], // purple  (#a855f7)
  NEON_COLORS[3], // amber   (#f59e0b)
  '#10b981',      // emerald
  '#3b82f6',      // blue
  '#f43f5e',      // rose
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

interface SignalRowProps {
  vehicleId: number;
  signal: string;
  liveValue: unknown;
  color: string;
  isWide: boolean;
}

function SignalSparklineRow({ vehicleId, signal, liveValue, color, isWide }: SignalRowProps) {
  const { fmtNumber } = useNumberFormatting();
  const historyQuery = useSignalHistory(vehicleId, encodeURIComponent(signal), 1);
  const { data: history } = historyQuery;
  const historyState = useDataState({
    ...historyQuery,
    data: historyQuery.isError && (!Array.isArray(history?.data) || history.data.length === 0) ? undefined : history,
  }, { provenance: 'historical' });
  const { t } = useTranslation('dashboard');

  const numericPoints = useMemo(() => {
    const points = Array.isArray(history?.data) ? history.data : [];
    return points
      .map((p) => p?.valueNum)
      .filter((v): v is number => v != null && isFinite(v));
  }, [history]);

  const currentValue = extractNumericValue(liveValue);
  const hasSparkline = numericPoints.length >= 2;

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
  const trendColor = trend === 'up' ? '#10b981' : trend === 'down' ? '#ef4444' : '#6b7280';
  const trendLabel =
    trend === 'up'
      ? t('widget.trendUp', 'Trending up')
      : trend === 'down'
        ? t('widget.trendDown', 'Trending down')
        : t('widget.trendFlat', 'No change');

  const label = formatSignalName(signal);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 py-1.5 border-b border-[var(--border-subtle)] last:border-b-0">
      {/* Color indicator (decorative — the row label carries the meaning) */}
      <div
        aria-hidden="true"
        className="w-1 h-6 rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
      />

      {/* Label + value */}
      <div className="min-w-0 flex-[1_1_5rem]">
        <Caption className="block break-words">
          {label}
        </Caption>
        <Text as="p" size="lg" weight="semibold" color="primary" className="break-all tabular-nums">
          {currentValue != null ? fmtNumber(currentValue) : '—'}
        </Text>
      </div>

      {/* Sparkline */}
      {historyState.fatalError ? <QueryError error={historyState.fatalError} onRetry={() => { void historyQuery.refetch(); }} /> : hasSparkline ? (
        <Sparkline
          data={numericPoints}
          color={color}
          width={isWide ? 80 : 56}
          height={20}
          ariaLabel={`${label} ${t('widget.trendSparkline', 'trend')}`}
        />
      ) : (
        <Caption className="w-14 break-words text-center">
          {t('widget.noHistory', 'no data')}
        </Caption>
      )}

      {/* Trend indicator — icon-only, so announce the direction to AT */}
      <span role="img" aria-label={numericPoints.length >= 4 ? trendLabel : t('widget.noHistory', 'no data')} className="flex-shrink-0">
        <TrendIcon className="h-3 w-3" style={{ color: trendColor }} aria-hidden="true" />
      </span>
      <StaleRefreshWarning state={historyState} className="w-full min-w-0" />
    </div>
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
      icon={<Activity className="h-3.5 w-3.5 text-neon-cyan" />}
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
