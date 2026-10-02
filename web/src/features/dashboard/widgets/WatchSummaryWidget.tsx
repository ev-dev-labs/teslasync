import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Watch, Lock, Unlock } from 'lucide-react';
import { LinearGauge } from '@/components/charts';
import { StatusBadge, TimeStamp } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { useWatchSummary, useWatchComplication } from '@/api/hooks/useWatch';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates, knownNumber } from '@/api/dataState';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, WidgetStatusGrid } from './shared';
import { dashboardTokens } from '../lib/dashboardTokens';
import type { WidgetProps } from './types';
import { convertDistanceFromSI, convertDistanceToSI, convertTempFromSI } from '@/lib/unitConversion';

// Battery state-of-charge health bands → gauge/accent color:
// healthy (>50%) emerald, low (>20%) amber, critical (≤20%) red.
export function getBatteryColor(level: number): string {
  if (level > 50) return '#10b981';
  if (level > 20) return '#f59e0b';
  return '#ef4444';
}

export default function WatchSummaryWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const summaryQuery = useWatchSummary(vehicleId);
  const {
    data: summary, isLoading: summaryLoading, isFetching: summaryFetching, isStale: summaryStale, isError: summaryError, dataUpdatedAt: summaryUpdatedAt, refetch: refetchSummary, } = summaryQuery;

  const complicationQuery = useWatchComplication(vehicleId);
  const {
    data: complication, isLoading: compLoading, } = complicationQuery;

  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const tempUnit = unitPrefs.temperature;

  const isCompact = size.cols <= 1;
  const isLoading = summaryLoading || compLoading;

  const batteryLevel = knownNumber(summary?.battery_level);
  const rangeKm = summary?.range_km ?? null;
  const state = summary?.state ?? null;
  const stateLabel = state === 'online'
    ? t('widget.watchState.online', 'Online')
    : state === 'asleep'
      ? t('widget.watchState.asleep', 'Asleep')
      : state === 'offline' ? t('widget.watchState.offline', 'Offline') : state;
  const isLocked = summary?.is_locked ?? null;
  const insideTempC = summary?.inside_temp_c ?? null;
  const lastUpdated = summary?.last_updated ?? null;
  const summaryTrust = useDataState({ ...summaryQuery, data: summary ?? (summaryLoading || summaryError ? undefined : null) }, { provenance: 'cached' });
  const complicationTrust = useDataState({ ...complicationQuery, data: complication ?? (compLoading || complicationQuery.isError ? undefined : null) }, { provenance: 'cached' });
  const combined = combineDataStates([summaryTrust, complicationTrust]);
  const dataState = {
    ...combined,
    status: !summary && !complication && isLoading ? 'initial' : combined.status,
    fatalError: !summary && summaryTrust.fatalError ? summaryTrust.fatalError : combined.fatalError,
    data: summary,
    hasData: summary != null,
    retry: () => { void refetchSummary(); void complicationQuery.refetch?.(); },
  } satisfies Parameters<typeof WidgetShell>[0]['dataState'];

  const displayRange = useMemo(() => {
    if (rangeKm == null) return null;
    // range_km is kilometres; lift to SI metres before the display-unit cast.
    return convertDistanceFromSI(convertDistanceToSI(rangeKm, 'km'), distanceUnit);
  }, [rangeKm, distanceUnit]);

  const displayTemp = useMemo(() => {
    if (insideTempC == null) return null;
    return convertTempFromSI(insideTempC, tempUnit);
  }, [insideTempC, tempUnit]);

  const color = useMemo(
    () => (batteryLevel != null ? getBatteryColor(batteryLevel) : '#374151'),
    [batteryLevel],
  );

  const handleRefresh = useCallback(() => {
    void refetchSummary();
    void complicationQuery.refetch?.();
  }, [refetchSummary, complicationQuery]);

  const hasData = summary != null;

  // Compact (1×2): Watch-face circular display
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        dataState={dataState}
        loadingContent={<div className="flex flex-col gap-2"><Skeleton className="h-16" /><Skeleton className="h-11" /></div>}
        updatedAt={combined.updatedAt ?? summaryUpdatedAt}
        isFetching={combined.isRefreshing || summaryFetching}
        isStale={summaryStale}
        isError={summaryError}
        onRefresh={handleRefresh}
      >
          <div className="h-full flex flex-col items-center justify-center gap-1.5 py-1">
            <div className="w-full">
              {batteryLevel == null ? <WidgetBigNumber value={null} label={t('widget.battery', 'Battery')} /> : <LinearGauge
                value={batteryLevel}
                max={100}
                label=""
                ariaLabel={t('widget.battery', 'Battery')}
                unit="%"
                color={color}
                size={80}
                decimals={0}
              />}
            </div>
            {state && <StatusBadge status={state} size="sm" />}
            {displayRange != null && (
              <span className={dashboardTokens.metricLabel}>
                {fmtNumber(displayRange, 0)} {distanceUnit}
              </span>
            )}
            {complication?.charging && (
              <span className={dashboardTokens.metricLabel}>
                ⚡ {t('widget.charging', 'Charging')}
              </span>
            )}
            {!hasData && !summaryLoading && <p className={dashboardTokens.metricLabel}>{t('widget.noWatchData', 'No watch data')}</p>}
          </div>
      </WidgetShell>
    );
  }

  // Standard (2×2+): Full watch summary with all fields
  return (
    <WidgetShell
      title={t('widget.watchSummary', 'Watch summary')}
      icon={<Watch className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
      loading={isLoading}
      dataState={dataState}
      loadingContent={<div className="flex flex-col gap-3"><Skeleton className="h-16" /><Skeleton className="h-24" /></div>}
      updatedAt={combined.updatedAt ?? summaryUpdatedAt}
      isFetching={combined.isRefreshing || summaryFetching}
      isStale={summaryStale}
      isError={summaryError}
      onRefresh={handleRefresh}
    >
        <div className="h-full flex flex-col gap-3">
          {/* Hero: Battery big number */}
          <WidgetBigNumber
            value={batteryLevel}
            unit="%"
            label={t('widget.battery', 'Battery')}
            badge={
              stateLabel
                ? {
                    text: stateLabel,
                    variant: state === 'online' ? 'success' : state === 'asleep' ? 'neutral' : 'warning',
                  }
                : undefined
            }
          />

          {/* Detail grid: 2 columns */}
          <WidgetStatGrid cols={2} stats={[
            {
              label: t('widget.range', 'Range'),
              value: displayRange == null ? null : fmtNumber(displayRange, 0),
              unit: displayRange == null ? undefined : distanceUnit,
            },
            {
              label: t('widget.cabinTemp', 'Cabin'),
              value: displayTemp == null ? null : fmtNumber(displayTemp, 0),
              unit: displayTemp == null ? undefined : tempUnit,
            },
          ]} />
          <WidgetStatusGrid cols={2} cells={[
            {
              id: 'lock',
              label: t('widget.lockStatus', 'Lock'),
              status: isLocked == null ? 'unknown' : isLocked ? 'ok' : 'warning',
              icon: isLocked === false ? <Unlock className="size-4" /> : <Lock className="size-4" />,
              statusLabel: isLocked == null ? '—' : isLocked ? t('widget.locked', 'Locked') : t('widget.unlocked', 'Unlocked'),
            },
            {
              id: 'charging',
              label: t('widget.charging', 'Charging'),
              status: complication?.charging == null ? 'unknown' : complication.charging ? 'ok' : 'inactive',
              statusLabel: complication?.charging == null
                ? t('widget.status.unknown', 'Unknown')
                : complication.charging
                  ? t('widget.charging', 'Charging')
                  : t('widget.status.inactive', 'Inactive'),
            },
          ]} />
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <span className={dashboardTokens.metricLabel}>{t('widget.lastSeen', 'Last seen')}</span>
              <span className="truncate max-w-full">
                <TimeStamp value={lastUpdated} className={dashboardTokens.metricLabel} />
              </span>
            </div>
          {!hasData && !summaryLoading && <p className={dashboardTokens.metricLabel}>{t('widget.noWatchData', 'No watch data')}</p>}
        </div>
    </WidgetShell>
  );
}
