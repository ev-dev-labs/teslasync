import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Watch, Lock, Unlock } from 'lucide-react';
import { LinearGauge } from '@/components/charts';
import { StatusBadge, AnimatedNumber, TimeStamp } from '@/components/data-display';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useWatchSummary, useWatchComplication } from '@/api/hooks/useWatch';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import type { WidgetProps } from './types';
import { convertDistanceFromSI, convertTempFromSI } from '@/lib/unitConversion';

// Battery state-of-charge health bands → gauge/accent color:
// healthy (>50%) emerald, low (>20%) amber, critical (≤20%) red.
export function getBatteryColor(level: number): string {
  if (level > 50) return '#10b981';
  if (level > 20) return '#f59e0b';
  return '#ef4444';
}

export default function WatchSummaryWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const {
    data: summary, isLoading: summaryLoading, isFetching: summaryFetching, isStale: summaryStale, isError: summaryError, dataUpdatedAt: summaryUpdatedAt, refetch: refetchSummary, } = useWatchSummary(vehicleId);

  const {
    data: complication, isLoading: compLoading, } = useWatchComplication(vehicleId);

  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const tempUnit = unitPrefs.temperature;

  const isCompact = size.cols <= 1;
  const isLoading = summaryLoading || compLoading;

  const batteryLevel = summary?.battery_level ?? null;
  const rangeKm = summary?.range_km ?? null;
  const state = summary?.state ?? null;
  const isLocked = summary?.is_locked ?? null;
  const insideTempC = summary?.inside_temp_c ?? null;
  const lastUpdated = summary?.last_updated ?? null;

  const displayRange = useMemo(() => {
    if (rangeKm == null) return null;
    // range_km is kilometres; lift to SI metres before the display-unit cast.
    return convertDistanceFromSI(rangeKm * 1000, distanceUnit);
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
  }, [refetchSummary]);

  const hasData = summary != null;

  // Compact (1×2): Watch-face circular display
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        updatedAt={summaryUpdatedAt}
        isFetching={summaryFetching}
        isStale={summaryStale}
        isError={summaryError}
        onRefresh={handleRefresh}
      >
        {hasData ? (
          <div className="h-full flex flex-col items-center justify-center gap-1.5 py-1">
            <div className="w-full">
              <LinearGauge
                value={batteryLevel ?? 0}
                max={100}
                label=""
                ariaLabel={t('widget.battery', 'Battery')}
                unit="%"
                color={color}
                size={80}
                decimals={0}
              />
            </div>
            {state && <StatusBadge status={state} size="sm" />}
            {displayRange != null && (
              <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                {fmtNumber(displayRange, 0)} {distanceUnit}
              </span>
            )}
            {complication?.charging && (
              <span className="text-2xs text-emerald-300 animate-pulse">
                ⚡ {t('widget.charging', 'Charging')}
              </span>
            )}
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Watch className="h-5 w-5" />}
            message={t('widget.noWatchData', 'No watch data')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  // Standard (2×2+): Full watch summary with all fields
  return (
    <WidgetShell
      title={t('widget.watchSummary', 'Watch Summary')}
      icon={<Watch className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
      loading={isLoading}
      updatedAt={summaryUpdatedAt}
      isFetching={summaryFetching}
      isStale={summaryStale}
      isError={summaryError}
      onRefresh={handleRefresh}
    >
      {hasData ? (
        <div className="h-full flex flex-col gap-3">
          {/* Hero: Battery big number */}
          <WidgetBigNumber
            value={batteryLevel}
            unit="%"
            label={t('widget.battery', 'Battery')}
            badge={
              state
                ? {
                    text: state,
                    variant: state === 'online' ? 'success' : state === 'asleep' ? 'neutral' : 'warning',
                  }
                : undefined
            }
          />

          {/* Detail grid: 2 columns */}
          <div className="grid grid-cols-2 gap-2">
            {/* Range */}
            <div className="flex flex-col items-center gap-0.5 rounded-lg bg-[var(--surface-2)] p-2 min-h-[44px] justify-center">
              <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
                {t('widget.range', 'Range')}
              </span>
              {displayRange != null ? (
                <span className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">
                  <AnimatedNumber value={displayRange} className="text-sm font-semibold text-[var(--text-primary)]" />
                  <span className="text-xs text-[var(--text-secondary)] ml-0.5">{distanceUnit}</span>
                </span>
              ) : (
                <span className="text-sm text-[var(--text-muted)]">—</span>
              )}
            </div>

            {/* Lock status */}
            <div className="flex flex-col items-center gap-0.5 rounded-lg bg-[var(--surface-2)] p-2 min-h-[44px] justify-center">
              <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
                {t('widget.lockStatus', 'Lock')}
              </span>
              {isLocked != null ? (
                <div className="flex items-center gap-1">
                  {isLocked ? (
                    <Lock className="h-4 w-4 text-neon-green" />
                  ) : (
                    <Unlock className="h-4 w-4 text-amber-400" />
                  )}
                  <Badge variant={isLocked ? 'success' : 'warning'} size="sm">
                    {isLocked
                      ? t('widget.locked', 'Locked')
                      : t('widget.unlocked', 'Unlocked')}
                  </Badge>
                </div>
              ) : (
                <span className="text-sm text-[var(--text-muted)]">—</span>
              )}
            </div>

            {/* Cabin temp */}
            <div className="flex flex-col items-center gap-0.5 rounded-lg bg-[var(--surface-2)] p-2 min-h-[44px] justify-center">
              <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
                {t('widget.cabinTemp', 'Cabin')}
              </span>
              {displayTemp != null ? (
                <span className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">
                  <AnimatedNumber value={displayTemp} className="text-sm font-semibold text-[var(--text-primary)]" />
                  <span className="text-xs text-[var(--text-secondary)] ml-0.5">{tempUnit}</span>
                </span>
              ) : (
                <span className="text-sm text-[var(--text-muted)]">—</span>
              )}
            </div>

            {/* Last updated */}
            <div className="flex flex-col items-center gap-0.5 rounded-lg bg-[var(--surface-2)] p-2 min-h-[44px] justify-center">
              <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
                {t('widget.lastSeen', 'Last Seen')}
              </span>
              <span className="truncate max-w-full">
                <TimeStamp value={lastUpdated} className="text-xs text-[var(--text-secondary)]" />
              </span>
            </div>
          </div>
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Watch className="h-6 w-6" />}
          message={t('widget.noWatchData', 'No watch data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
