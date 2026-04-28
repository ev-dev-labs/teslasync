import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Wrench, CheckCircle2, Clock } from 'lucide-react';
import { Badge } from '@/components/ui';
import { Timeline } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useMaintenance, useServiceRecords } from '@/api/hooks/useVehicleSystems';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

/** Determine urgency based on interval months remaining (heuristic). */
function getUrgency(intervalMonths: number): 'overdue' | 'soon' | 'good' {
  if (intervalMonths <= 0) return 'overdue';
  if (intervalMonths <= 3) return 'soon';
  return 'good';
}

function urgencyBadgeVariant(urgency: string): 'danger' | 'warning' | 'success' {
  if (urgency === 'overdue') return 'danger';
  if (urgency === 'soon') return 'warning';
  return 'success';
}

function urgencyLabel(urgency: string, t: (k: string, f: string) => string): string {
  if (urgency === 'overdue') return t('widget.maintenance.overdue', 'Overdue');
  if (urgency === 'soon') return t('widget.maintenance.soon', 'Soon');
  return t('widget.maintenance.good', 'Good');
}

export default function MaintenanceTrackerWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { convertDistance, distanceUnit, formatCurrency } = useSettings();

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
      const odometerDisplay = fmtNumber(convertDistance((rec.odometerKm ?? 0) * 0.621371), 0);
      return {
        icon: <CheckCircle2 className="h-3 w-3" />,
        title: mi?.name ?? rec.itemId ?? '—',
        subtitle: rec.notes
          ? `${odometerDisplay} ${distanceUnit} · ${rec.notes}`
          : `${odometerDisplay} ${distanceUnit}`,
        time: rec.date
          ? new Date(rec.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
          : '—',
        color: '#10b981',
      };
    });
  }, [recentRecords, items, convertDistance, distanceUnit]);

  const updatedAt = Math.max(maintUpdatedAt ?? 0, recordsUpdatedAt ?? 0);
  const hasData = items.length > 0 || records.length > 0;

  const shellProps = {
    loading: isLoading,
    updatedAt,
    isFetching: maintFetching || recordsFetching,
    isStale: maintStale,
    isError: maintIsError,
    onRefresh: () => maintRefetch(),
  };

  // ── Compact layout (1×2): days until next + item name ──
  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        <div className="h-full flex flex-col items-center justify-center gap-1.5 min-h-[44px]">
          {nextItem ? (
            <>
              <Wrench className="h-4 w-4 text-amber-400" />
              <span className="text-2xl font-bold text-white/90">
                {fmtInt(nextItem.intervalMonths ?? 0)}
              </span>
              <span className="text-[10px] text-white/40 uppercase tracking-wider">
                {t('widget.maintenance.monthsLeft', 'months')}
              </span>
              <span className="text-xs text-white/60 truncate max-w-full px-2 text-center">
                {nextItem.name ?? '—'}
              </span>
            </>
          ) : (
            <EmptyState
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
                <span className="text-[10px] text-white/40 uppercase tracking-wider">
                  {t('widget.maintenance.nextService', 'Next Service')}
                </span>
                <Badge variant={urgencyBadgeVariant(nextUrgency)} size="sm" dot>
                  {urgencyLabel(nextUrgency, t)}
                </Badge>
              </div>
              <p className="text-sm font-semibold text-white/90 truncate">
                {nextItem.name ?? '—'}
              </p>
              <div className="flex items-center gap-3 mt-1.5 text-xs text-white/50">
                <span className="flex items-center gap-1 min-h-[44px] min-w-[44px] justify-center">
                  <Clock className="h-3 w-3 shrink-0" />
                  {t('widget.maintenance.every', 'Every')}{' '}
                  {fmtInt(nextItem.intervalMonths ?? 0)}{' '}
                  {t('widget.maintenance.months', 'mo')}
                </span>
                <span className="flex items-center gap-1">
                  {fmtNumber(convertDistance((nextItem.intervalKm ?? 0) * 0.621371), 0)}{' '}
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
              <span className="text-[10px] text-white/40 uppercase tracking-wider block mb-2">
                {t('widget.maintenance.recentService', 'Recent Service')}
              </span>
              <Timeline items={timelineItems} />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-xs text-white/30">
                {t('widget.maintenance.noRecords', 'No service records yet')}
              </span>
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          icon={<Wrench className="h-5 w-5" />}
          message={t('widget.maintenance.noData', 'No maintenance data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
