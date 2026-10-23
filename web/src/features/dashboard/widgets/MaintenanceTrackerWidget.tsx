import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wrench } from 'lucide-react';
import { SourceContent } from '@/components/layout';
import { Skeleton } from '@/components/feedback';
import { Button, Caption, Drawer } from '@/components/ui';
import { useMaintenance, useServiceRecords, useMaintenanceForecast } from '@/api/hooks/useVehicleSystems';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates, knownNumber } from '@/api/dataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useDateLabels } from '@/hooks/useDateLabels';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetDetailCard, type DetailEntry } from './shared';
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

function knownForecastCount(value: unknown): number | null {
  const count = knownNumber(value);
  return count != null && Number.isInteger(count) && count >= 0 ? count : null;
}

export default function MaintenanceTrackerWidget({ size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const [forecastOpen, setForecastOpen] = useState(false);
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const toDistanceDisplay = useCallback(
    (km: number) =>
      convertDistanceFromSI(convertDistanceToSI(km, 'km'), distanceUnit),
    [distanceUnit],
  );
  const { formatDate } = useDateFormat();
  const { formatRelativeDays } = useDateLabels();

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
  const forecastOverdue = knownForecastCount(forecast?.overdue_count)
    ?? null;
  const forecastDueSoon = knownForecastCount(forecast?.due_soon_count)
    ?? null;

  // Sort maintenance items by interval (soonest first)
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => (a.intervalMonths ?? Infinity) - (b.intervalMonths ?? Infinity)),
    [items],
  );

  const nextItem = sortedItems[0] ?? null;
  const recentRecords = useMemo(
    () =>
      [...records]
        .sort((a, b) => new Date(b.date ?? '').getTime() - new Date(a.date ?? '').getTime())
        .slice(0, 3),
    [records],
  );

  const upcomingEntries = useMemo<DetailEntry[]>(() => {
    const rank = (status: string | undefined) =>
      status === 'overdue' ? 0 : status === 'due_soon' ? 1 : status === 'good' ? 2 : 3;
    return [...items]
      .sort((a, b) => {
      const fa = (forecast?.items ?? []).find((f) => f.name === a.name && f.category === a.category);
      const fb = (forecast?.items ?? []).find((f) => f.name === b.name && f.category === b.category);
      return rank(fa?.status) - rank(fb?.status)
        || (a.intervalMonths ?? Infinity) - (b.intervalMonths ?? Infinity);
      })
      .slice(0, 3)
      .map((item, index) => {
      const evidence = (forecast?.items ?? []).find((f) => f.name === item.name && f.category === item.category);
      const status = evidence?.status === 'overdue'
        ? 'error' as const
        : evidence?.status === 'due_soon'
          ? 'warning' as const
          : evidence?.status === 'good'
            ? 'success' as const
            : 'neutral' as const;
      const distance = item.intervalKm == null ? null : `${fmtNumber(toDistanceDisplay(item.intervalKm))} ${distanceUnit}`;
      const interval = item.intervalMonths != null && distance
        ? item.intervalMonths >= 12
          ? `${t('widget.maintenance.every', 'Every')} ${fmtInt(item.intervalMonths / 12)} ${t('widget.maintenance.years', 'years')} · ${distance}`
          : `${t('widget.maintenance.every', 'Every')} ${fmtInt(item.intervalMonths)} ${t('widget.maintenance.monthsShort', 'mo')} · ${distance}`
        : distance
          ? `${t('widget.maintenance.every', 'Every')} ${distance}`
          : item.intervalMonths != null
            ? `${t('widget.maintenance.every', 'Every')} ${fmtInt(item.intervalMonths)} ${t('widget.maintenance.monthsShort', 'mo')}`
            : null;
      let remaining: string | null = null;
      if (evidence?.km_remaining != null && Number.isFinite(evidence.km_remaining)) {
        remaining = `${fmtNumber(toDistanceDisplay(evidence.km_remaining))} ${distanceUnit}`;
      } else if (evidence?.due_date) {
        remaining = formatRelativeDays(evidence.due_date);
      } else if (item.intervalKm != null) {
        remaining = `${fmtNumber(toDistanceDisplay(item.intervalKm))} ${distanceUnit}`;
      } else if (item.intervalMonths != null) {
        remaining = `${fmtInt(item.intervalMonths)} ${t('widget.maintenance.monthsShort', 'mo')}`;
      }
      return {
        id: item.id || index,
        label: item.name ?? '—',
        sublabel: interval ?? undefined,
        value: remaining ?? '—',
        hint: remaining ? t('widget.maintenance.left', 'left') : undefined,
        status,
        badge: evidence
          ? {
              text: evidence.status === 'overdue'
                ? t('widget.maintenance.overdue', 'Overdue')
                : evidence.status === 'due_soon'
                  ? t('widget.maintenance.soon', 'Soon')
                  : t('widget.maintenance.good', 'Good'),
              variant: evidence.status === 'overdue'
                ? 'error' as const
                : evidence.status === 'due_soon'
                  ? 'warning' as const
                  : 'success' as const,
            }
          : {
              text: t('widget.status.unknown', 'Unknown'),
              variant: 'neutral' as const,
            },
      };
    });
  }, [items, forecast?.items, toDistanceDisplay, distanceUnit, fmtNumber, fmtInt, formatRelativeDays, t]);

  const lastServiceEntries = useMemo<DetailEntry[]>(() => {
    return recentRecords.slice(0, 1).map((rec, index) => {
      const item = items.find((entry) => entry.id === rec.itemId);
      const serviceDate = rec.date ? formatDate(rec.date) : '—';
      const notes = rec.notes?.trim() || null;
      return {
      id: rec.itemId || index,
      label: item?.name ?? rec.itemId ?? '—',
      sublabel: notes ? `${serviceDate} · ${notes}` : serviceDate,
      value: rec.odometerKm == null ? null : `${fmtNumber(toDistanceDisplay(rec.odometerKm))} ${distanceUnit}`,
      hint: rec.odometerKm != null ? t('widget.maintenance.odometer', 'odometer') : undefined,
      };
    });
  }, [recentRecords, items, formatDate, fmtNumber, toDistanceDisplay, distanceUnit, t]);

  const updatedAt = combined.updatedAt ?? Math.min(maintUpdatedAt || Infinity, recordsUpdatedAt || Infinity);
  const hasData = items.length > 0 || records.length > 0;

  const handleRefresh = useCallback(() => {
    maintRefetch();
    void recordsQuery.refetch?.();
    void forecastQuery.refetch?.();
  }, [maintRefetch, recordsQuery, forecastQuery]);

  const shellProps = {
    title: t('widget.maintenance.title', 'Maintenance'),
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

  // ── Compact layout (1×2): configured interval + item name ──
  if (isCompact) {
    return (
      <WidgetShell
        {...shellProps}
      >
        <div className="h-full flex flex-col items-center justify-center gap-1.5 min-h-[44px]">
          <SourceContent
            state={maintenanceTrust.fatalError ? 'error' : !maintenanceTrust.hasData && maintLoading ? 'loading' : 'ready'}
            label={t('widget.maintenance.title', 'Maintenance')}
            emptyMessage={t('widget.maintenance.noData', 'No maintenance data')}
            errorMessage={t('widget.maintenance.itemsError', 'Configured maintenance could not be loaded.')}
            error={maintenanceTrust.fatalError}
            errorRecovery={{ onRetry: maintenanceTrust.retry ?? undefined }}
          >
          {nextItem ? (
            <>
              <Wrench className="h-4 w-4 text-amber-400" />
              <WidgetBigNumber
                value={nextItem.intervalMonths == null ? null : fmtInt(nextItem.intervalMonths)}
                unit={t('widget.maintenance.monthsLeft', 'months')}
                label={t('widget.maintenance.configuredInterval', 'Configured interval')}
                align="center"
              />
              <Caption className="max-w-full break-words px-2 text-center">
                {nextItem.name ?? '—'}
              </Caption>
            </>
          ) : (
            <WidgetBigNumber value={null} label={t('widget.maintenance.noData', 'No maintenance data')} />
          )}
          </SourceContent>
          <Caption className="block break-words">{t('widget.maintenance.intervalCaveat', 'Intervals are recommendations, not time remaining.')}</Caption>
        </div>
      </WidgetShell>
    );
  }

  // ── Standard layout (2×4): split view ──
  return (
    <WidgetShell
      icon={<Wrench className="h-3.5 w-3.5 text-amber-400" />}
      {...shellProps}
    >
      <div className="h-full flex min-h-0 flex-col overflow-y-auto">
        <section data-testid="dashboard-maintenance-forecast-brief" className="mb-2 rounded-panel border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2">
          <Caption className="mb-2 block">{t('widget.maintenance.forecastStatus', 'Maintenance forecast summary')}</Caption>
          <div className="grid grid-cols-3 gap-2">
            <span data-operational-value>{t('widget.maintenance.overdue', 'Overdue')}: {fmtInt(forecastOverdue ?? 0)}</span>
            <span data-operational-value>{t('widget.maintenance.soon', 'Soon')}: {fmtInt(forecastDueSoon ?? 0)}</span>
            <span data-operational-value>{t('widget.maintenance.dailyDistance', 'Daily distance')}: {forecast?.km_per_day == null ? '—' : `${fmtNumber(Number(forecast.km_per_day), 2)} km/day`}</span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setForecastOpen(true)}>{t('common.reviewDetails', 'Review details')}</Button>
        </section>
        <Drawer open={forecastOpen} onClose={() => setForecastOpen(false)} title={`Forecast vehicle ${forecast?.vehicle_id ?? ''}`}>
          <div className="space-y-2">
            <Caption>{t('widget.maintenance.forecastCaveat', 'Forecast depends on recorded service history and mileage.')}</Caption>
          </div>
        </Drawer>
        {(forecastOverdue != null || forecastDueSoon != null) && (
          <div
            role="status"
            aria-label={t('widget.maintenance.forecastStatus', 'Maintenance forecast status')}
            className="mb-2 flex min-w-0 flex-wrap items-center gap-2 rounded-panel border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2"
          >
            {forecastOverdue != null && (
              <span className="text-xs text-[var(--text-primary)]">
                {t('widget.maintenance.overdue', 'Overdue')}: <strong>{fmtInt(forecastOverdue)}</strong>
              </span>
            )}
            {forecastDueSoon != null && (
              <span className="text-xs text-[var(--text-primary)]">
                {t('widget.maintenance.soon', 'Soon')}: <strong>{fmtInt(forecastDueSoon)}</strong>
              </span>
            )}
          </div>
        )}
        <Caption as="h3" className="mb-1 block">
          {t('widget.maintenance.upcoming', 'Upcoming')}
        </Caption>
        <SourceContent
          state={maintenanceTrust.fatalError ? 'error' : !maintenanceTrust.hasData && maintLoading ? 'loading' : maintenanceTrust.refreshError ? 'retained' : 'ready'}
          label={t('widget.maintenance.upcoming', 'Upcoming')}
          emptyMessage={t('widget.maintenance.noData', 'No maintenance data')}
          errorMessage={t('widget.maintenance.itemsError', 'Configured maintenance could not be loaded.')}
          error={maintenanceTrust.fatalError}
          errorRecovery={{ onRetry: maintenanceTrust.retry ?? undefined }}
          retainedMessage={t('widget.maintenance.itemsRetained', 'Previously loaded maintenance intervals remain visible while they refresh.')}
        >
          <WidgetDetailCard
            entries={upcomingEntries}
            emptyMessage={t('widget.maintenance.noData', 'No maintenance data')}
            emptyIcon={<Wrench className="h-5 w-5" />}
          />
        </SourceContent>

        <Caption className="mb-1 mt-3 block">{t('widget.maintenance.lastService', 'Last service')}</Caption>
        <SourceContent
          state={recordsTrust.fatalError ? 'error' : !recordsTrust.hasData && recordsLoading ? 'loading' : lastServiceEntries.length === 0 ? 'empty' : recordsTrust.refreshError ? 'retained' : 'ready'}
          label={t('widget.maintenance.lastService', 'Last service')}
          emptyMessage={t('widget.maintenance.noRecords', 'No service records yet')}
          errorMessage={t('widget.maintenance.recordsError', 'Service records could not be loaded.')}
          error={recordsTrust.fatalError}
          errorRecovery={{ onRetry: recordsTrust.retry ?? undefined }}
          retainedMessage={t('widget.maintenance.recordsRetained', 'Previously loaded service records remain visible while they refresh.')}
        >
          {lastServiceEntries.length > 0 ? (
            <ul role="list" aria-label={t('widget.maintenance.recentService', 'Recent service')} className="m-0 list-none space-y-2 p-0">
              {recentRecords.slice(0, 3).map((rec, index) => (
                <li key={rec.itemId || index} role="listitem" className="rounded-panel border border-[var(--border-subtle)] px-3 py-2">
                  <span className="block text-sm font-medium text-[var(--text-primary)]">{items.find((entry) => entry.id === rec.itemId)?.name ?? rec.itemId ?? '—'}</span>
                  <span className="block text-xs text-[var(--text-muted)]">{rec.notes ?? '—'}</span>
                  <span className="block text-xs text-[var(--text-muted)]">{rec.date ? formatDate(rec.date) : '—'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <WidgetDetailCard entries={[]} emptyMessage={t('widget.maintenance.noRecords', 'No service records yet')} emptyIcon={<Wrench className="h-5 w-5" />} />
          )}
        </SourceContent>
      </div>
    </WidgetShell>
  );
}
