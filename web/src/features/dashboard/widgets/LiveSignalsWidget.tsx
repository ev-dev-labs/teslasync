import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Radio } from 'lucide-react';
import { Caption, Text } from '@/components/ui';
import { Sparkline, CHART_COLORS } from '@/components/charts';
import { EmptyState, QueryError } from '@/components/feedback';
import { deriveDataState } from '@/api/dataState';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSignalHistory, useVehicleLiveSignals, type VehicleLiveSignal } from '@/api/hooks/useTelemetry';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { useTicker } from '@/hooks/useTicker';
import { cn } from '@/lib/cn';

import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { SignalObservation, WidgetBigNumber } from './shared';
import type { WidgetProps } from './types';

const LIVE_SIGNAL_NAMES = [
  'BatteryLevel',
  'ACChargingPower',
  'InsideTemp',
  'OutsideTemp',
  'RatedRange',
] as const;

function liveEntryValue(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
    return (raw as VehicleLiveSignal).value;
  }
  return raw;
}

function finiteNumber(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function signalValue(name: typeof LIVE_SIGNAL_NAMES[number], entry: unknown): number | null {
  const value = finiteNumber(liveEntryValue(entry));
  if (value == null || (name === 'BatteryLevel' && (value < 0 || value > 100))
    || (name === 'RatedRange' && value < 0)) return null;
  return value;
}

export default function LiveSignalsWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { fmtNumber } = useNumberFormatting();
  const { data: vehicles } = useVehicles();
  const { formatPower, formatTemperature, formatDistance } = useUnits();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  useTicker(id > 0);

  const liveQuery = useVehicleLiveSignals(id || undefined, { refetchInterval: 5_000 });
  const liveData = liveQuery.data;
  const liveState = useDataState(liveQuery, { provenance: 'live' });

  const batteryHistory = useSignalHistory(id, 'BatteryLevel', 1);
  const powerHistory = useSignalHistory(id, 'ACChargingPower', 1);
  const insideHistory = useSignalHistory(id, 'InsideTemp', 1);
  const outsideHistory = useSignalHistory(id, 'OutsideTemp', 1);
  const rangeHistory = useSignalHistory(id, 'RatedRange', 1);
  const historyQueries = [
    batteryHistory,
    powerHistory,
    insideHistory,
    outsideHistory,
    rangeHistory,
  ] as const;

  const signals = (liveData?.signals ?? {}) as Record<string, unknown>;
  const hasLiveData = LIVE_SIGNAL_NAMES.some((name) => signals[name] != null);

  const rows = useMemo(() => LIVE_SIGNAL_NAMES.map((name, index) => {
    const raw = signalValue(name, signals[name]);
    const entry = signals[name] && typeof signals[name] === 'object'
      ? signals[name] as VehicleLiveSignal : null;
    const timestamp = entry?.timestamp ?? entry?.ts;
    const observedMs = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN;
    const observedAt = Number.isFinite(observedMs) && observedMs > 0 && observedMs <= Date.now() ? observedMs : null;
    let formatted: string;
    if (raw == null) formatted = '—';
    else if (name === 'BatteryLevel') formatted = `${fmtNumber(raw, 0)} %`;
    else if (name === 'ACChargingPower') formatted = formatPower(raw, { precision: 1 });
    else if (name === 'InsideTemp' || name === 'OutsideTemp') formatted = formatTemperature(raw, { precision: 1 });
    else formatted = formatDistance(raw, { precision: 1 });

    const history = historyQueries[index].data?.data ?? [];
    const points = history
      .map((point) => finiteNumber(point.value))
      .filter((point): point is number => point != null);
    const samples = history.map(point => ({
      timestamp: Date.parse(point.ts),
      value: finiteNumber(point.value),
    }));
    const timedCount = samples.filter(point => Number.isFinite(point.timestamp) && point.value != null).length;

    return {
      name, raw, formatted, points, samples, timedCount, observedAt,
      unknown: raw == null || observedAt == null || entry?.source === 'unknown',
      source: entry?.source,
      stale: entry?.source === 'stale' || (entry?.age_ms ?? 0) >= 120_000
        || (observedAt != null && Date.now() - observedAt >= 120_000),
      historyState: deriveDataState(historyQueries[index], { provenance: 'historical', unavailable: points.length === 0 }),
      color: CHART_COLORS[index % CHART_COLORS.length],
    };
  }), [signals, fmtNumber, formatPower, formatTemperature, formatDistance, historyQueries]);
  const hasHistoryData = rows.some((row) => row.points.length > 0);
  const compact = size.cols <= 1;

  const handleRefresh = () => {
    void liveQuery.refetch();
    historyQueries.forEach((query) => { void query.refetch(); });
  };

  const empty = (
    <EmptyState
      variant="informational"
      icon={<Radio className="h-5 w-5" />}
      message={t('widget.noSignals', 'No live signal data')}
      description={t('widget.noSignalsDescription', 'Live values appear when the selected vehicle publishes telemetry.')}
      className="py-4"
    />
  );
  const list = (enhanced: boolean) => (
    <ul className="overflow-y-auto" aria-label={t('widget.liveSignals', 'Live signals')}>
      {rows.map((row) => (
        <li key={row.name}
          className={cn('grid min-h-10 items-center gap-2 border-b border-[var(--border-subtle)] py-1.5 last:border-b-0',
            enhanced && compact ? 'grid-cols-[minmax(0,1fr)_max-content]' : 'grid-cols-[minmax(6rem,1fr)_minmax(56px,72px)_minmax(72px,max-content)]')}>
          <Text mono size="sm" color="primary" className={cn('min-w-0', enhanced ? 'break-words' : 'truncate')} title={row.name}>
            {row.name}
          </Text>
          <div className={cn('min-w-0', enhanced && compact && 'col-span-2 row-start-2 flex items-center justify-between gap-2')}>
            {(enhanced ? row.timedCount : row.points.length) >= 2 ? (
              <Sparkline {...(enhanced ? { samples: row.samples } : { data: row.points })}
                color={row.color} width={72} height={20} ariaLabel={`${row.name} ${t('widget.trendSparkline', 'trend')}`} />
            ) : (
              <span aria-hidden="true" className="block h-px w-full bg-[var(--border-subtle)]" />
            )}
            {enhanced && <Caption className="block break-words">
              {row.historyState.fatalError ? t('dashboardWidgets.telemetry.liveSignalsHistoryError', 'Trend unavailable')
                : row.historyState.refreshError || row.historyState.isRefreshBlocked ? t('dashboardWidgets.telemetry.liveSignalsHistoryRetained', 'Retained trend')
                  : row.historyState.status === 'initial' ? t('dashboardWidgets.telemetry.liveSignalsHistoryLoading', 'Loading trend')
                    : row.timedCount < 2 ? t('dashboardWidgets.telemetry.liveSignalsHistoryEmpty', 'Insufficient history') : null}
            </Caption>}
          </div>
          <div className={cn('flex items-center justify-end gap-1', enhanced && 'flex-col items-end text-end', enhanced && compact && 'col-start-2 row-start-1')}>
            <Text mono size="sm" weight="semibold" color="primary" className="text-end tabular-nums whitespace-nowrap">
              {row.formatted}
            </Text>
            {enhanced && <SignalObservation observedAt={row.observedAt} source={row.source}
              unknown={row.unknown} stale={row.stale}
              retained={liveState.status === 'stale'} />}
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <WidgetShell
      title={t('widget.liveSignals', 'Live signals')}
      icon={<Radio className="h-3.5 w-3.5 text-theme-accent" />}
      dataState={{
        ...liveState,
        retry: handleRefresh,
        data: liveData,
        hasData: hasLiveData || hasHistoryData,
        status: hasHistoryData && !liveState.hasData ? 'partial' : liveState.status,
        fatalError: hasLiveData || hasHistoryData ? null : liveState.fatalError,
      }}
      updatedAt={liveQuery.dataUpdatedAt}
      refreshIntervalMs={5_000}
      isFetching={liveQuery.isFetching}
      isStale={liveQuery.isStale}
      isError={liveQuery.isError}
      onRefresh={handleRefresh}
    >
      <InstrumentPresentation family="list" compact={compact}
        icon={<Radio aria-hidden="true" />}
        headline={<WidgetBigNumber value={liveData ? rows.filter((row) => row.raw != null).length : null}
          unit={t('dashboardWidgets.telemetry.liveSignalsCountUnit', 'signals')}
          label={t('dashboardWidgets.telemetry.liveSignalsSnapshot', 'Live signal snapshot')} animated={false} />}
        context={liveState.fatalError && hasHistoryData ? <QueryError compact error={liveState.fatalError} onRetry={handleRefresh} /> : undefined}
        instrument={<>{!hasLiveData && empty}{list(true)}</>}
        details={<Caption>{t('dashboardWidgets.telemetry.liveSignalsObservationNote', 'Each signal has its own observation time and freshness.')}</Caption>}>
        {!hasLiveData ? empty : list(false)}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
