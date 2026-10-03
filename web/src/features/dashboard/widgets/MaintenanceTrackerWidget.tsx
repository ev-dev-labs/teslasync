import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Wrench, CheckCircle2, Clock } from 'lucide-react';
import { Badge } from '@/components/ui';
import { Timeline } from '@/components/data-display';
import { Skeleton, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { useMaintenance, useServiceRecords, useMaintenanceForecast } from '@/api/hooks/useVehicleSystems';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates } from '@/api/dataState';

import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, WidgetStatusGrid } from './shared';
import { dashboardTokens } from '../lib/dashboardTokens';
import type { WidgetProps } from './types';
import { convertDistanceFromSI, convertDistanceToSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export type Urgency = 'overdue' | 'soon' | 'good';

/** Determine urgency based on interval months remaining (heuristic). */
export function getUrgency(intervalMonths: number): Urgency {
  if (intervalMonths <= 0) return 'overdue';
  if (intervalMonths <= 3) return 'soon';
  return 'good';
}

export function urgencyBadgeVariant(urgency: Urgency): 'danger' | 'warning' | 'success' {
  if (urgency === 'overdue') return 'danger';
  if (urgency === 'soon') return 'warning';
  return 'success';
}

export function urgencyLabel(urgency: Urgency, t: (k: string, f: string) => string): string {
  if (urgency === 'overdue') return t('widget.maintenance.overdue', 'Overdue');
  if (urgency === 'soon') return t('widget.maintenance.soon', 'Soon');
  return t('widget.maintenance.good', 'Good');
}

export default function MaintenanceTrackerWidget({ size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  // Odometer + service-interval distances arrive in kilometres. Restate them as
  // SI metres before the SI→display converter, otherwise the value is off by the
  // 1000× km→m prefix (e.g. 20,000 km would render as "20 km" / "12 mi").
  const toDistanceDisplay = useCallback(
    (km: number) =>
      convertDistanceFromSI(convertDistanceToSI(km, 'km'), distanceUnit),
    [distanceUnit],
  );

  const { formatCurrency } = useFormatting();
  const { formatDate } = useDateFormat();

  const maintenanceQuery = useMaintenance();
  const {
    data: maintenanceItems,
    isLoading: maintLoading,
    isFetching: maintFetching,
    isStale: maintStale,
    isError: maintIsError,
    dataUpdatedAt: maintUpdatedAt,
    refetch: maintRefetch,
  } = maintenanceQuery;

  const recordsQuery = useServiceRecords();
  const {
    data: serviceRecords,
    isLoading: recordsLoading,
    isFetching: recordsFetching,
    dataUpdatedAt: recordsUpdatedAt,
  } = recordsQuery;

  const forecastQuery = useMaintenanceForecast();
  const { data: forecast } = forecastQuery;
  const maintenanceTrust = useDataState({ ...maintenanceQuery, data: maintenanceItems ?? (maintLoading || maintIsError ? undefined : []) }, { provenance: 'historical' });
  const recordsTrust = useDataState({ ...recordsQuery, data: serviceRecords ?? (recordsLoading || recordsQuery.isError ? undefined : []) }, { provenance: 'historical' });
  const forecastTrust = useDataState({ ...forecastQuery, data: forecast ?? (forecastQuery.isLoading || forecastQuery.isError ? undefined : null) }, { provenance: 'inferred' });
  const combined = combineDataStates([maintenanceTrust, recordsTrust, forecastTrust]);

  const isLoading = maintLoading || recordsLoading;
  const isCompact = size.cols <= 1;
  const items = maintenanceItems ?? [];
  const records = serviceRecords ?? [];

  // Sort maintenance items by interval (soonest first)
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => (a.intervalMonths ?? Infinity) - (b.intervalMonths ?? Infinity)),
    [items],
  );

  const nextItem = sortedItems[0] ?? null;
  // An interval is a recommendation, not a countdown. Due status comes only
  // from the forecast's recorded-service/mileage calculation.
  const matchingForecast = (forecast?.items ?? []).find((item) =>
    item.name === nextItem?.name && item.category === nextItem?.category,
  );
  const nextUrgency = matchingForecast?.status === 'overdue'
    ? 'overdue' : matchingForecast?.status === 'due_soon'
      ? 'soon' : matchingForecast?.status === 'good' ? 'good' : null;

  // Sort service records by date desc, take last 3
  const recentRecords = useMemo(
    () =>
      [...records]
        .sort((a, b) => new Date(b.date ?? '').getTime() - new Date(a.date ?? '').getTime())
        .slice(0, 3),
    [records],
  );

  // Map service records to timeline items
  const timelineItems = useMemo(() => {
    // Look up maintenance item name by itemId
    const itemMap = new Map(items.map((m) => [m.id, m]));
    return recentRecords.map((rec) => {
      const mi = itemMap.get(rec.itemId);
      const odometerDisplay = rec.odometerKm == null ? '—' : `${fmtNumber(toDistanceDisplay(rec.odometerKm))} ${distanceUnit}`;
      return {
        icon: <CheckCircle2 className="h-3 w-3" />,
        title: mi?.name ?? rec.itemId ?? '—',
        subtitle: rec.notes
          ? `${odometerDisplay} · ${rec.notes}`
          : odometerDisplay,
        time: rec.date
          ? formatDate(rec.date)
          : '—',
        color: '#10b981',
      };
    });
  }, [recentRecords, items, toDistanceDisplay, distanceUnit, formatDate, fmtNumber]);

  const updatedAt = combined.updatedAt ?? Math.min(maintUpdatedAt || Infinity, recordsUpdatedAt || Infinity);
  const hasData = items.length > 0 || records.length > 0;

  const handleRefresh = useCallback(() => {
    maintRefetch();
    void recordsQuery.refetch?.();
    void forecastQuery.refetch?.();
  }, [maintRefetch, recordsQuery, forecastQuery]);

  const shellProps = {
    loading: isLoading,
    dataState: {
      ...combined,
      status: !hasData && isLoading ? 'initial' : combined.status,
      data: [maintenanceItems, serviceRecords, forecast],
      hasData: hasData || forecast != null,
      retry: handleRefresh,
    } satisfies Parameters<typeof WidgetShell>[0]['dataState'],
    loadingContent: <div className="flex flex-col gap-3"><Skeleton className="h-20" /><Skeleton className="h-24" /></div>,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    isFetching: maintFetching || recordsFetching,
    isStale: maintStale,
    isError: maintIsError,
    onRefresh: handleRefresh,
  };

  // ── Compact layout (1×2): days until next + item name ──
  if (isCompact) {
    return (
      <WidgetShell
        {...shellProps}
      >
        <div className="h-full flex flex-col items-center justify-center gap-1.5 min-h-[44px]">
          {nextItem ? (
            <>
              <Wrench className="h-4 w-4 text-amber-400" />
              <WidgetBigNumber
                value={nextItem.intervalMonths == null ? null : fmtInt(nextItem.intervalMonths)}
                unit={t('widget.maintenance.monthsLeft', 'months')}
                label={t('widget.maintenance.configuredInterval', 'Configured interval')}
                align="center"
              />
              <span className={`${dashboardTokens.metricLabel} max-w-full break-words px-2 text-center`}>
                {nextItem.name ?? '—'}
              </span>
            </>
          ) : (
            <WidgetBigNumber value={null} label={t('widget.maintenance.noData', 'No maintenance data')} />
          )}
          <p className={dashboardTokens.metricLabel}>{t('widget.maintenance.intervalCaveat', 'Intervals are recommendations, not time remaining.')}</p>
        </div>
      </WidgetShell>
    );
  }

  // ── Standard layout (2×4): split view ──
  return (
    <WidgetShell
      title={t('widget.maintenance.title', 'Maintenance')}
      icon={<Wrench className="h-3.5 w-3.5 text-amber-400" />}
      {...shellProps}
    >
        <div className="h-full flex flex-col gap-3 overflow-y-auto">
          {/* Top: Next upcoming maintenance */}
            <div className="border-b border-[var(--border-subtle)] pb-3">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className={dashboardTokens.metricLabel}>
                  {t('widget.maintenance.shortestInterval', 'Shortest configured interval')}
                </span>
                <Badge variant={nextUrgency ? urgencyBadgeVariant(nextUrgency) : 'neutral'} size="sm" dot>
                  {nextUrgency ? urgencyLabel(nextUrgency, t) : t('widget.status.unknown', 'Unknown')}
                </Badge>
              </div>
              <p className={dashboardTokens.metricLabel}>
                {nextItem?.name ?? '—'}
              </p>
              <div className={`flex flex-wrap items-center gap-3 mt-1.5 ${dashboardTokens.metricLabel}`}>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3 shrink-0" />
                  {t('widget.maintenance.every', 'Every')}{' '}
                  {nextItem?.intervalMonths == null ? '—' : fmtInt(nextItem.intervalMonths)}{' '}
                  {t('widget.maintenance.months', 'mo')}
                </span>
                <span className="flex items-center gap-1">
                  {nextItem?.intervalKm == null ? '—' : `${fmtNumber(toDistanceDisplay(nextItem.intervalKm))} ${distanceUnit}`}
                </span>
                {nextItem?.estimatedCostUsd != null && (
                  <span>{formatCurrency(nextItem.estimatedCostUsd)}</span>
                )}
              </div>
              <p className={dashboardTokens.metricLabel}>{t('widget.maintenance.intervalCaveat', 'Intervals are recommendations, not time remaining.')}</p>
            </div>

          {/* Wear forecast banner: mileage/time-aware due counts */}
            <div
              className="flex min-w-0 flex-col gap-2"
              role="status"
              aria-label={t('widget.maintenance.forecastStatus', 'Maintenance forecast status')}
            >
              <StaleRefreshWarning state={forecastTrust} />
              {forecastTrust.fatalError && <QueryError error={forecastTrust.fatalError} onRetry={forecastTrust.retry ?? undefined} />}
              <WidgetStatGrid cols={3} stats={[
                { label: t('widget.maintenance.overdue', 'Overdue'), value: forecast?.overdue_count },
                { label: t('widget.maintenance.soon', 'Soon'), value: forecast?.due_soon_count },
                { label: t('widget.maintenance.dailyDistance', 'Daily distance'), value: forecast?.km_per_day == null ? null : fmtNumber(toDistanceDisplay(forecast.km_per_day)), unit: forecast?.km_per_day == null ? undefined : `${distanceUnit}/${t('widget.maintenance.dayUnit', 'day')}` },
              ]} />
              <p className={dashboardTokens.metricLabel}>
                {t('widget.maintenance.forecastCaveat', 'Forecast depends on recorded service history and mileage.')}
              </p>
              <WidgetStatusGrid cells={[{
                id: 'forecast-source',
                label: t('widget.maintenance.forecastVehicle', 'Forecast vehicle'),
                value: forecast?.vehicle_id == null ? '—' : String(forecast.vehicle_id),
                status: forecast == null ? 'unknown' : 'inactive',
                statusLabel: t('widget.maintenance.estimated', 'Estimated'),
              }]} />
            </div>

          {/* Bottom: Recent service records */}
          {recentRecords.length > 0 ? (
            <div className="flex-1 min-h-0">
              <span className={`${dashboardTokens.metricLabel} block mb-2`}>
                {t('widget.maintenance.recentService', 'Recent service')}
              </span>
              <Timeline items={timelineItems} />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <span className={dashboardTokens.metricLabel}>
                {t('widget.maintenance.noRecords', 'No service records yet')}
              </span>
            </div>
          )}
          {!hasData && <p className={dashboardTokens.metricLabel}>{t('widget.maintenance.noData', 'No maintenance data')}</p>}
        </div>
    </WidgetShell>
  );
}
