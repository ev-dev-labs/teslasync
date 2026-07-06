import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Wrench, CheckCircle2, Clock } from 'lucide-react';
import { Badge } from '@/components/ui';
import { Timeline } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useMaintenance, useServiceRecords } from '@/api/hooks/useVehicleSystems';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';

/** SI prefix: 1 km = 1000 m. Restores true SI metres from the km-scaled fields. */
const METERS_PER_KM = 1000;

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
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  // Odometer + service-interval distances arrive in kilometres. Restate them as
  // SI metres before the SI→display converter, otherwise the value is off by the
  // 1000× km→m prefix (e.g. 20,000 km would render as "20 km" / "12 mi").
  const toDistanceDisplay = useCallback(
    (km: number | null | undefined) =>
      convertDistanceFromSI((km ?? 0) * METERS_PER_KM, distanceUnit),
    [distanceUnit],
  );

  const { formatCurrency } = useFormatting();
  const { formatDate } = useDateFormat();

  const {
    data: maintenanceItems,
    isLoading: maintLoading,
    isFetching: maintFetching,
    isStale: maintStale,
    isError: maintIsError,
    dataUpdatedAt: maintUpdatedAt,
    refetch: maintRefetch,
  } = useMaintenance();

  const {
    data: serviceRecords,
    isLoading: recordsLoading,
    isFetching: recordsFetching,
    dataUpdatedAt: recordsUpdatedAt,
  } = useServiceRecords();

  const isLoading = maintLoading || recordsLoading;
  const isCompact = size.cols <= 1;
  const items = maintenanceItems ?? [];
  const records = serviceRecords ?? [];

  // Sort maintenance items by interval (soonest first)
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => (a.intervalMonths ?? 0) - (b.intervalMonths ?? 0)),
    [items],
  );

  const nextItem = sortedItems[0] ?? null;
  const nextUrgency = nextItem ? getUrgency(nextItem.intervalMonths ?? 0) : null;

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
      const odometerDisplay = fmtNumber(toDistanceDisplay(rec.odometerKm), 0);
      return {
        icon: <CheckCircle2 className="h-3 w-3" />,
        title: mi?.name ?? rec.itemId ?? '—',
        subtitle: rec.notes
          ? `${odometerDisplay} ${distanceUnit} · ${rec.notes}`
          : `${odometerDisplay} ${distanceUnit}`,
        time: rec.date
          ? formatDate(rec.date)
          : '—',
        color: '#10b981',
      };
    });
  }, [recentRecords, items, toDistanceDisplay, distanceUnit, formatDate]);

  const updatedAt = Math.max(maintUpdatedAt ?? 0, recordsUpdatedAt ?? 0);
  const hasData = items.length > 0 || records.length > 0;

  const handleRefresh = useCallback(() => {
    maintRefetch();
  }, [maintRefetch]);

  const shellProps = {
    loading: isLoading,
    updatedAt,
    isFetching: maintFetching || recordsFetching,
    isStale: maintStale,
    isError: maintIsError,
    onRefresh: handleRefresh,
  };

  // ── Compact layout (1×2): days until next + item name ──
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        updatedAt={maintUpdatedAt}
        isFetching={maintFetching}
        isStale={maintStale}
        isError={maintIsError}
        onRefresh={handleRefresh}
      >
        <div className="h-full flex flex-col items-center justify-center gap-1.5 min-h-[44px]">
          {nextItem ? (
            <>
              <Wrench className="h-4 w-4 text-amber-400" />
              <span className="text-2xl font-bold text-[var(--text-primary)]">
                {fmtInt(nextItem.intervalMonths ?? 0)}
              </span>
              <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
                {t('widget.maintenance.monthsLeft', 'months')}
              </span>
              <span className="text-xs text-[var(--text-secondary)] truncate max-w-full px-2 text-center">
                {nextItem.name ?? '—'}
              </span>
            </>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Wrench className="h-5 w-5" />}
              message={t('widget.maintenance.noData', 'No maintenance data')}
              className="py-2"
            />
          )}
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
      {hasData ? (
        <div className="h-full flex flex-col gap-3 overflow-y-auto">
          {/* Top: Next upcoming maintenance */}
          {nextItem && nextUrgency && (
            <div className="rounded-lg bg-white/[0.03] p-3 border border-white/[0.06]">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
                  {t('widget.maintenance.nextService', 'Next Service')}
                </span>
                <Badge variant={urgencyBadgeVariant(nextUrgency)} size="sm" dot>
                  {urgencyLabel(nextUrgency, t)}
                </Badge>
              </div>
              <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                {nextItem.name ?? '—'}
              </p>
              <div className="flex items-center gap-3 mt-1.5 text-xs text-[var(--text-secondary)]">
                <span className="flex items-center gap-1 min-h-[44px] min-w-[44px] justify-center">
                  <Clock className="h-3 w-3 shrink-0" />
                  {t('widget.maintenance.every', 'Every')}{' '}
                  {fmtInt(nextItem.intervalMonths ?? 0)}{' '}
                  {t('widget.maintenance.months', 'mo')}
                </span>
                <span className="flex items-center gap-1">
                  {fmtNumber(toDistanceDisplay(nextItem.intervalKm), 0)}{' '}
                  {distanceUnit}
                </span>
                {nextItem.estimatedCostUsd != null && nextItem.estimatedCostUsd > 0 && (
                  <span>{formatCurrency(nextItem.estimatedCostUsd)}</span>
                )}
              </div>
            </div>
          )}

          {/* Bottom: Recent service records */}
          {recentRecords.length > 0 ? (
            <div className="flex-1 min-h-0">
              <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider block mb-2">
                {t('widget.maintenance.recentService', 'Recent Service')}
              </span>
              <Timeline items={timelineItems} />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-xs text-[var(--text-muted)]">
                {t('widget.maintenance.noRecords', 'No service records yet')}
              </span>
            </div>
          )}
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Wrench className="h-5 w-5" />}
          message={t('widget.maintenance.noData', 'No maintenance data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
