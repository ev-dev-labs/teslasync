import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Radio } from 'lucide-react';
import { Text } from '@/components/ui';
import { Sparkline, CHART_COLORS } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSignalHistory, useVehicleLiveSignals, type VehicleLiveSignal } from '@/api/hooks/useTelemetry';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';

import { WidgetShell } from './WidgetShell';
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

export default function LiveSignalsWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { fmtNumber } = useNumberFormatting();
  const { data: vehicles } = useVehicles();
  const { formatPower, formatTemperature, formatDistance } = useUnits();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

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
    const raw = finiteNumber(liveEntryValue(signals[name]));
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

    return { name, formatted, points, color: CHART_COLORS[index % CHART_COLORS.length] };
  }), [signals, fmtNumber, formatPower, formatTemperature, formatDistance, historyQueries]);

  const handleRefresh = () => {
    void liveQuery.refetch();
    historyQueries.forEach((query) => { void query.refetch(); });
  };

  return (
    <WidgetShell
      title={t('widget.liveSignals', 'Live signals')}
      icon={<Radio className="h-3.5 w-3.5 text-neon-cyan" />}
      dataState={{
        ...liveState,
        retry: handleRefresh,
        data: liveData,
        hasData: hasLiveData,
        fatalError: hasLiveData ? null : liveState.fatalError,
      }}
      updatedAt={liveQuery.dataUpdatedAt}
      refreshIntervalMs={5_000}
      isFetching={liveQuery.isFetching}
      isStale={liveQuery.isStale}
      isError={liveQuery.isError}
      onRefresh={handleRefresh}
    >
      {!hasLiveData ? (
        <EmptyState
          variant="informational"
          icon={<Radio className="h-5 w-5" />}
          message={t('widget.noSignals', 'No live signal data')}
          description={t(
            'widget.noSignalsDescription',
            'Live values appear when the selected vehicle publishes telemetry.',
          )}
          className="py-4"
        />
      ) : (
        <ul className="overflow-y-auto" aria-label={t('widget.liveSignals', 'Live signals')}>
          {rows.map((row) => (
            <li
              key={row.name}
              className="grid min-h-10 grid-cols-[minmax(6rem,1fr)_minmax(56px,72px)_minmax(72px,max-content)] items-center gap-2 border-b border-[var(--border-subtle)] py-1.5 last:border-b-0"
            >
              <Text mono size="sm" color="primary" className="min-w-0 truncate" title={row.name}>
                {row.name}
              </Text>
              {row.points.length >= 2 ? (
                <Sparkline data={row.points} color={row.color} width={72} height={20} ariaLabel={`${row.name} ${t('widget.trendSparkline', 'trend')}`} />
              ) : (
                <span aria-hidden="true" className="h-px w-full bg-[var(--border-subtle)]" />
              )}
              <Text mono size="sm" weight="semibold" color="primary" className="text-end tabular-nums whitespace-nowrap">
                {row.formatted}
              </Text>
            </li>
          ))}
        </ul>
      )}
    </WidgetShell>
  );
}
