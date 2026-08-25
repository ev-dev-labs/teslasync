/**
 * AlertsListPage — alert-entity list with stats, gauges, charts and
 * acknowledge/timeline actions. Was the "Alerts" tab of the legacy
 * AlertsPage; promoted to its own top-level route under the
 * Notifications group as part of the alerts/notifications consolidation.
 *
 * The History/Preferences tabs from the old page are gone — History was a
 * duplicate of /notifications/inbox, and Preferences was a localStorage-only
 * fallback for what /notifications/quiet-hours owns canonically.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { PageContainer } from '@/components/layout';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { PanelTitle, Text } from '@/components/ui/Typography';
import { Pagination } from '@/components/ui/Pagination';
import { TabNav } from '@/components/ui/TabNav';
import { PinButton } from '@/components/ui/PinButton';
import { PrintButton } from '@/components/ui/PrintButton';
import { Checkbox } from '@/components/ui';
import { useUrlEnum, useUrlNumber, useUrlString, useUrlBatch } from '@/hooks/useUrlState';

import { SavedViewMenu } from '@/components/data-display/SavedViewMenu';
import {
  BulkActionsToolbar,
  type BulkAction,
  KpiOverviewCard,
  MetricCard,
} from '@/components/data-display';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { fmtInt } from '@/lib/numberFormat';
import { EmptyState } from '@/components/feedback/EmptyState';
import { QueryError } from '@/components/feedback/QueryError';
import { Skeleton } from '@/components/feedback/Skeleton';
import { InlineCallout } from '@/components/feedback/InlineCallout';
import { FadeIn } from '@/components/motion/FadeIn';
import { StaggerContainer } from '@/components/motion/StaggerContainer';
import { StaggerItem } from '@/components/motion/StaggerItem';
import { SearchInput, FilterBar, ActiveFilterChips, RangePicker, type FilterChipDescriptor } from '@/components/forms';
import { useFilteredList } from '@/hooks/useFilteredList';
import { useRangeState } from '@/hooks/useRangeState';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
  ChartLegend, ChartTooltip, EmbeddedChart,
} from '@/components/charts';
import { useToast } from '@/components/feedback/Toast';
import { usePageTitle } from '@/hooks/usePageTitle';
import { CHART_COLORS } from '@/lib/colors';
import { priorPeriod } from '@/lib/drivesAggregation';
import {
  useAlerts, useMarkAlertRead, useAlertRules,
  useAcknowledgeAlert as useAcknowledgeAlertHook,
  useReopenAlert as useReopenAlertHook,
  useAlertDetail as useAlertDetailHook,
  useBulkSetAlertsRead,
} from '@/api/hooks/useNotifications';
import { usePinned } from '@/api/hooks/usePinned';
import type { Alert } from '@/api/types';
import { Icons } from '@/lib/icons';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { AcknowledgeAlertDialog } from '@/features/admin/components/AcknowledgeAlertDialog';
import { AlertCard } from '../components/AlertCard';
import { AlertOperationalBrief } from '../components/AlertOperationalBrief';
import { AlertDetailDrawer } from '../components/AlertDetailDrawer';

type AlertSeverity = 'info' | 'warning' | 'critical';
type AlertFilter =
  | 'all'
  | 'unread'
  | 'open'
  | 'acknowledged'
  | 'critical'
  | 'open-critical';

/**
 * Hex fills for the stacked severity trend bars. Held as a const map (never
 * inline hex in JSX) and aligned with `severityTokens` semantics so the chart
 * reads the same as the severity badges: info=sky, warning=amber, critical=red.
 */
const SEVERITY_HEX: Record<AlertSeverity, string> = {
  info: '#38bdf8',
  warning: '#f59e0b',
  critical: '#ef4444',
};

interface QuietHours { start: string; end: string; enabled: boolean }

const DEFAULT_QUIET_HOURS: QuietHours = { start: '22:00', end: '07:00', enabled: false };

/**
 * Read the legacy localStorage quiet-hours fallback. Validates the parsed
 * shape defensively: a corrupted or non-object payload (e.g. the literal
 * `"null"`, a bare number, or a truncated blob) must NOT leak through as the
 * return value, or `isQuietHoursActive` would dereference a non-object and
 * throw. Exported for unit testing.
 */
export function loadQuietHours(): QuietHours {
  try {
    const raw = localStorage.getItem('teslasync-quiet-hours');
    if (!raw) return { ...DEFAULT_QUIET_HOURS };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_QUIET_HOURS };
    const obj = parsed as Partial<QuietHours>;
    return {
      start: typeof obj.start === 'string' ? obj.start : DEFAULT_QUIET_HOURS.start,
      end: typeof obj.end === 'string' ? obj.end : DEFAULT_QUIET_HOURS.end,
      enabled: obj.enabled === true,
    };
  } catch {
    return { ...DEFAULT_QUIET_HOURS };
  }
}

/**
 * Whether the current wall-clock time falls inside the quiet-hours window.
 * Tolerates a missing/malformed argument (returns `false`) and handles the
 * midnight-wrapping case (start > end). Exported for unit testing.
 */
export function isQuietHoursActive(qh: QuietHours | null | undefined): boolean {
  if (!qh?.enabled) return false;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (qh.start <= qh.end) return hhmm >= qh.start && hhmm < qh.end;
  return hhmm >= qh.start || hhmm < qh.end;
}

function rangeBoundaryToISO(date: string, inclusiveEnd: boolean): string | undefined {
  const boundary = new Date(
    `${date}T${inclusiveEnd ? '23:59:59.999' : '00:00:00.000'}`,
  );
  return Number.isNaN(boundary.getTime()) ? undefined : boundary.toISOString();
}

export default function AlertsListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePageTitle(t('Alerts'));
  const toast = useToast();
  const savedView = useSavedViewUrl();
  const { locale } = useDateFormat();

  const [filter] = useUrlEnum<AlertFilter>(
    'filter',
    ['all', 'unread', 'open', 'acknowledged', 'critical', 'open-critical'] as const,
    'all',
  );
  const [alertSearch] = useUrlString('q', '');
  const [alertPage, setAlertPage] = useUrlNumber('page', 1);
  // filter / q / page are separate URL keys but are always changed together
  // (any status or search change resets pagination). Writing them through the
  // atomic batcher avoids the react-router v6 snapshot race where two
  // single-key `setX(..., {replace})` calls in one handler discard each other.
  const setUrlParams = useUrlBatch();
  const alertsPerPage = 20;

  const { vehicleId, vehicle } = useSelectedVehicle();
  const { start, end, setRange } = useRangeState({
    persistKey: 'alerts.range',
    defaultPresetId: 'all',
  });
  const prior = useMemo(() => priorPeriod(start, end), [start, end]);
  const alertListScope = useMemo(
    () => ({
      from: rangeBoundaryToISO(prior?.start ?? start, false),
      to: rangeBoundaryToISO(end, true),
      vehicle_id: vehicleId ?? undefined,
      fetchAll: true,
    }),
    [prior?.start, start, end, vehicleId],
  );
  const alertsQuery = useAlerts(alertListScope);
  const { data: rawAlerts, isLoading, error } = alertsQuery;
  const alerts = useMemo(() => {
    if (!rawAlerts?.length) return rawAlerts;
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return rawAlerts.filter((a) => {
      if (!a.created_at) return false;
      const createdMs = new Date(a.created_at).getTime();
      const inVehicleScope =
        vehicleId == null ||
        a.all_vehicles === true ||
        (Array.isArray(a.vehicle_ids)
          ? a.vehicle_ids.includes(vehicleId)
          : a.vehicle_id === vehicleId || a.vehicle_id <= 0);
      return createdMs >= startMs && createdMs <= endMs && inVehicleScope;
    });
  }, [rawAlerts, start, end, vehicleId]);
  const rulesQuery = useAlertRules();
  const { data: rules } = rulesQuery;
  const markReadMut = useMarkAlertRead();
  const bulkSetReadMut = useBulkSetAlertsRead();
  const ackMut = useAcknowledgeAlertHook({ showSuccessToast: false });
  const reopenMut = useReopenAlertHook();
  const bulkSelection = useBulkSelection<number>();
  const [ackDialogId, setAckDialogId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const detailQuery = useAlertDetailHook(detailId, { enabled: detailId !== null });
  const ackTarget = useMemo(() => alerts?.find((a) => a.id === ackDialogId) ?? null, [alerts, ackDialogId]);
  const detailTarget = useMemo(() => alerts?.find((a) => a.id === detailId) ?? null, [alerts, detailId]);
  const { data: rulePins = [] } = usePinned('alert_rule');
  const pinnedRules = useMemo(() => {
    if (!rules || rulePins.length === 0) return [];
    const order = new Map<string, number>();
    rulePins.forEach(p => order.set(String(p.item_id), p.position));
    return rules
      .filter(r => order.has(String(r.id)))
      .sort((a, b) => (order.get(String(a.id)) ?? 0) - (order.get(String(b.id)) ?? 0));
  }, [rules, rulePins]);

  const tabFilteredAlerts = useMemo(() => alerts?.filter(a => {
    if (filter === 'unread') return !a.is_read;
    if (filter === 'open') return !a.acknowledged_at;
    if (filter === 'acknowledged') return Boolean(a.acknowledged_at);
    if (filter === 'critical') return a.severity === 'critical';
    if (filter === 'open-critical') {
      return a.severity === 'critical' && !a.acknowledged_at;
    }
    return true;
  }) ?? [], [alerts, filter]);

  const alertSearchFields = useMemo(
    () => ['title', 'message'] as const satisfies ReadonlyArray<keyof Alert>,
    [],
  );
  const filteredAlerts = useFilteredList(tabFilteredAlerts, alertSearch, alertSearchFields);
  const visibleAlertIds = useMemo(
    () => filteredAlerts.map((alert) => alert.id),
    [filteredAlerts],
  );
  const bulkSelectionState = bulkSelection.masterState(visibleAlertIds);
  const selectedUnreadCount = useMemo(
    () =>
      filteredAlerts.reduce(
        (count, alert) =>
          count + (bulkSelection.selectedIds.has(alert.id) && !alert.is_read ? 1 : 0),
        0,
      ),
    [filteredAlerts, bulkSelection.selectedIds],
  );

  useEffect(() => {
    if (
      bulkSetReadMut.isPending ||
      markReadMut.isPending ||
      ackMut.isPending ||
      reopenMut.isPending
    ) {
      return;
    }
    const visible = new Set(visibleAlertIds);
    for (const id of bulkSelection.selectedIds) {
      if (!visible.has(id)) bulkSelection.setSelected(id, false);
    }
  }, [
    visibleAlertIds,
    bulkSelection.selectedIds,
    bulkSelection.setSelected,
    bulkSetReadMut.isPending,
    markReadMut.isPending,
    ackMut.isPending,
    reopenMut.isPending,
  ]);

  useEffect(() => {
    if (bulkSelection.count === 0) return;
    const clearOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') bulkSelection.clear();
    };
    window.addEventListener('keydown', clearOnEscape);
    return () => window.removeEventListener('keydown', clearOnEscape);
  }, [bulkSelection.count, bulkSelection.clear]);

  const totalPages = Math.max(1, Math.ceil(filteredAlerts.length / alertsPerPage));
  const safeAlertPage = Math.min(alertPage, totalPages);
  const pagedAlerts = filteredAlerts.slice((safeAlertPage - 1) * alertsPerPage, safeAlertPage * alertsPerPage);

  const totalCount = alerts?.length ?? 0;
  const unreadCount = useMemo(() => alerts?.filter(a => !a.is_read).length ?? 0, [alerts]);
  const criticalCount = useMemo(() => alerts?.filter(a => a.severity === 'critical').length ?? 0, [alerts]);
  const openCount = useMemo(() => alerts?.filter(a => !a.acknowledged_at).length ?? 0, [alerts]);
  const acknowledgedCount = totalCount - openCount;
  const openCriticalCount = useMemo(
    () => alerts?.filter(a => a.severity === 'critical' && !a.acknowledged_at).length ?? 0,
    [alerts],
  );
  const infoCount = useMemo(() => alerts?.filter(a => (a.severity ?? 'info') === 'info').length ?? 0, [alerts]);
  const warningCount = useMemo(() => alerts?.filter(a => a.severity === 'warning').length ?? 0, [alerts]);
  const readCount = useMemo(() => alerts?.filter(a => a.is_read === true).length ?? 0, [alerts]);
  const enabledRules = rules?.filter(r => r.enabled).length ?? 0;
  const readRatePct = totalCount > 0 ? Math.round((readCount / totalCount) * 100) : null;

  /* ── Prior-period stats for KPI deltas ──────────────────────── */
  const priorAlerts = useMemo(() => {
    if (!rawAlerts?.length || !prior) return [];
    const startMs = new Date(`${prior.start}T00:00:00`).getTime();
    const endMs = new Date(`${prior.end}T23:59:59.999`).getTime();
    return rawAlerts.filter((a) => {
      if (!a.created_at) return false;
      const createdMs = new Date(a.created_at).getTime();
      const inVehicleScope =
        vehicleId == null ||
        a.all_vehicles === true ||
        (Array.isArray(a.vehicle_ids)
          ? a.vehicle_ids.includes(vehicleId)
          : a.vehicle_id === vehicleId || a.vehicle_id <= 0);
      return createdMs >= startMs && createdMs <= endMs && inVehicleScope;
    });
  }, [rawAlerts, prior, vehicleId]);
  const priorTotal = priorAlerts.length;
  const priorUnread = useMemo(() => priorAlerts.filter(a => !a.is_read).length, [priorAlerts]);
  const priorCritical = useMemo(() => priorAlerts.filter(a => a.severity === 'critical').length, [priorAlerts]);
  const priorWarning = useMemo(() => priorAlerts.filter(a => a.severity === 'warning').length, [priorAlerts]);
  const priorInfo = useMemo(() => priorAlerts.filter(a => (a.severity ?? 'info') === 'info').length, [priorAlerts]);
  const priorRead = useMemo(() => priorAlerts.filter(a => a.is_read === true).length, [priorAlerts]);
  const priorReadRatePct = priorTotal > 0 ? Math.round((priorRead / priorTotal) * 100) : null;
  const priorHasData = priorTotal > 0;
  const periodLabel = `${start} – ${end}`;
  const priorLabel = prior
    ? t('common.vsRange', 'vs {{range}}', { range: `${prior.start} – ${prior.end}` })
    : undefined;

  const alertsByType = useMemo(() => {
    if (!alerts?.length) return [];
    const counts: Record<string, number> = {};
    alerts.forEach(a => {
      const key = a.type ?? 'notification';
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count], i) => ({
        name: (type ?? 'notification').replace(/_/g, ' '),
        value: count,
        fill: CHART_COLORS[i % CHART_COLORS.length],
      }));
  }, [alerts]);

  const alertsByDay = useMemo(() => {
    if (!alerts?.length) return [];
    const days: Record<string, { info: number; warning: number; critical: number }> = {};
    const now = Date.now();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const key = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d);
      days[key] = { info: 0, warning: 0, critical: 0 };
    }
    alerts.forEach(a => {
      const d = new Date(a.created_at);
      // Guard Intl.DateTimeFormat().format() against an invalid date — it
      // throws RangeError on NaN, which would crash the whole page.
      if (Number.isNaN(d.getTime())) return;
      if (now - d.getTime() > 7 * 86400000) return;
      const key = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d);
      const sev = a.severity as AlertSeverity;
      if (days[key] && (sev === 'info' || sev === 'warning' || sev === 'critical')) {
        days[key][sev]++;
      }
    });
    return Object.entries(days).map(([day, v]) => ({ day, ...v }));
  }, [alerts, locale]);

  const weekAlertCount = useMemo(() =>
    alertsByDay.reduce((s, d) => s + d.info + d.warning + d.critical, 0),
  [alertsByDay]);

  const [quietHours] = useState<QuietHours>(loadQuietHours);
  const quietActive = isQuietHoursActive(quietHours);

  const handleMarkRead = useCallback((id: number) => {
    markReadMut.mutate(String(id), {
      onSuccess: () => toast.info(t('Alert marked as read')),
    });
  }, [markReadMut, toast, t]);

  const handleAcknowledgeSubmit = useCallback((note: string) => {
    if (ackDialogId === null) return;
    const id = ackDialogId;
    setAckDialogId(null);
    ackMut.mutate(
      { id, note },
      {
        onSuccess: () => {
          toast.toast({
            type: 'success',
            title: t('alerts.ack.success', 'Alert acknowledged'),
            duration: 5000,
            action: {
              label: t('alerts.ack.undo', 'Undo'),
              onClick: () => {
                reopenMut.mutate(id);
              },
            },
          });
        },
      },
    );
  }, [ackDialogId, ackMut, reopenMut, toast, t]);

  const handleReopen = useCallback((id: number) => {
    reopenMut.mutate(id);
  }, [reopenMut]);

  const bulkAlertActions = useMemo<BulkAction[]>(
    () => [
      {
        id: 'mark-read',
        label: t('operations.alerts.bulk.markRead', 'Mark read'),
        icon: <Icons.show className="h-3.5 w-3.5" aria-hidden="true" />,
        disabled: selectedUnreadCount === 0,
        onClick: async (ids) => {
          const alertIds = ids.map(Number).filter((id) => Number.isInteger(id) && id > 0);
          if (alertIds.length === 0) return;
          await bulkSetReadMut.mutateAsync({ ids: alertIds, read: true });
          for (const id of alertIds) {
            bulkSelection.setSelected(id, false);
          }
          toast.toast({
            type: 'success',
            title: t(
              'operations.alerts.bulk.markReadSuccess',
              '{{count}} alerts marked as read',
              { count: alertIds.length },
            ),
            duration: 5000,
            action: {
              label: t('common.undo', 'Undo'),
              onClick: () => {
                bulkSetReadMut.mutate({ ids: alertIds, read: false });
              },
            },
          });
        },
      },
    ],
    [
      bulkSelection.setSelected,
      bulkSetReadMut,
      selectedUnreadCount,
      t,
      toast,
    ],
  );

  const applyStatusFilter = useCallback((next: AlertFilter) => {
    setUrlParams({ filter: next === 'all' ? null : next, page: null });
  }, [setUrlParams]);

  const applySearch = useCallback((value: string) => {
    setUrlParams({ q: value, page: null });
  }, [setUrlParams]);

  const clearAllFilters = useCallback(() => {
    setUrlParams({ q: null, filter: null, page: null });
  }, [setUrlParams]);

  const vehicleLabel =
    vehicle?.display_name?.trim() ||
    vehicle?.vin ||
    (vehicleId != null
      ? t('operations.alerts.vehicleNumber', 'Vehicle #{{id}}', { id: vehicleId })
      : t('operations.alerts.allVehicles', 'All vehicles'));

  return (
    <PageContainer
      title={t('Alerts')}
      subtitle={t('alerts.subtitle', 'Live alert events from your fleet')}
      copyLink
      query={alertsQuery}
      busy={isLoading}
      contextActions={
        <>
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="alerts-range"
          />
          {quietActive && <Badge variant="info" size="sm">{t('Quiet hours')}</Badge>}
        </>
      }
      overflowActions={
        <div data-print-hide className="flex items-center gap-2">
          {/* Saved-view route key is intentionally pinned to '/alerts' so
              pre-existing user-saved views from the legacy /alerts route
              continue to apply on this new page. */}
          <SavedViewMenu
            route="/alerts"
            currentQuery={savedView.currentQuery}
            onApply={savedView.apply}
          />
          <PrintButton />
        </div>
      }
    >
      {error && (
        <QueryError
          error={error}
          onRetry={() => { void alertsQuery.refetch(); }}
          resourceName={t('operations.alerts.feed', 'alert feed')}
        />
      )}
      {rulesQuery.error && (
        <InlineCallout variant="warning" icon={<Icons.alertCircle className="h-4 w-4" />}>
          {t(
            'operations.alerts.rulesUnavailable',
            'Alert events remain available, but rule status could not be loaded.',
          )}
        </InlineCallout>
      )}

      <FadeIn>
        {isLoading ? (
          <GlassPanel className="space-y-4 p-5" data-testid="alerts-operational-brief-skeleton">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-full max-w-2xl" />
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-24" />)}
            </div>
          </GlassPanel>
        ) : !error ? (
          <AlertOperationalBrief
            alerts={alerts ?? []}
            periodLabel={periodLabel}
            vehicleLabel={vehicleLabel}
            query={alertsQuery}
            onViewCritical={() => applyStatusFilter('open-critical')}
            onManageRules={() => navigate('/notifications/studio')}
          />
        ) : null}
      </FadeIn>

      <FadeIn delay={0.05}>
        {isLoading ? (
          <GlassPanel className="grid grid-cols-2 gap-3 p-5 md:grid-cols-3 xl:grid-cols-6">
            {[1, 2, 3, 4, 5, 6].map((item) => <Skeleton key={item} className="h-24" />)}
          </GlassPanel>
        ) : !error && (totalCount > 0 || priorHasData) ? (
          <KpiOverviewCard
            id="alerts-overview"
            testId="alerts-overview"
            header={{
              title: t('alerts.overview', 'Overview'),
              currentLabel: periodLabel,
              comparisonLabel: priorLabel,
            }}
            kpis={
              <>
                <MetricCard
                  label={t('Total')}
                  value={fmtInt(totalCount)}
                  color="cyan"
                  delta={priorHasData ? {
                    metric: { direction: 'neutral' },
                    previous: priorTotal,
                    current: totalCount,
                    display: 'percent',
                  } : undefined}
                />
                <MetricCard
                  label={t('Critical')}
                  value={fmtInt(criticalCount)}
                  color="red"
                  delta={priorHasData ? {
                    metric: { direction: 'lower_better' },
                    previous: priorCritical,
                    current: criticalCount,
                    display: 'percent',
                  } : undefined}
                />
                <MetricCard
                  label={t('Warnings')}
                  value={fmtInt(warningCount)}
                  color="amber"
                  delta={priorHasData ? {
                    metric: { direction: 'lower_better' },
                    previous: priorWarning,
                    current: warningCount,
                    display: 'percent',
                  } : undefined}
                />
                <MetricCard
                  label={t('Info')}
                  value={fmtInt(infoCount)}
                  color="cyan"
                  delta={priorHasData ? {
                    metric: { direction: 'neutral' },
                    previous: priorInfo,
                    current: infoCount,
                    display: 'percent',
                  } : undefined}
                />
                <MetricCard
                  label={t('Unread')}
                  value={fmtInt(unreadCount)}
                  color="purple"
                  delta={priorHasData ? {
                    metric: { direction: 'lower_better' },
                    previous: priorUnread,
                    current: unreadCount,
                    display: 'percent',
                  } : undefined}
                />
                <MetricCard
                  label={t('alerts.readRate', 'Read rate')}
                  value={readRatePct != null ? `${readRatePct}%` : '—'}
                  color="green"
                  delta={priorHasData && readRatePct != null && priorReadRatePct != null ? {
                    metric: { direction: 'higher_better' },
                    previous: priorReadRatePct,
                    current: readRatePct,
                    display: 'absolute',
                  } : undefined}
                />
              </>
            }
            secondary={
              <Text as="span" variant="caption" className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link to="/notifications/studio" className="hover:text-cyan-300 transition-colors">
                  {t('Active Rules')} <Text as="span" mono color="secondary">{enabledRules}/{rules?.length ?? 0}</Text> →
                </Link>
                <span aria-hidden>·</span>
                <span>
                  {t('Most Common')}: <Text as="span" color="secondary">{alertsByType[0]?.name ?? '—'}</Text>
                </span>
                <span aria-hidden>·</span>
                <span>
                  {t('Last 7 Days')}: <Text as="span" mono color="secondary">{fmtInt(weekAlertCount)}</Text>
                </span>
                {quietActive && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="text-amber-300">{t('Quiet hours active')}</span>
                  </>
                )}
              </Text>
            }
            footer={openCriticalCount > 0 ? (
              <InlineCallout
                variant="danger"
                icon={<Icons.alertCircle className="h-4 w-4" />}
                action={{
                  label: t('alerts.viewCritical', 'View critical'),
                  onClick: () => applyStatusFilter('open-critical'),
                }}
              >
                {t('alerts.criticalCallout', '{{count}} critical alert needs attention', { count: openCriticalCount })}
              </InlineCallout>
            ) : undefined}
          />
        ) : !error ? (
          <GlassPanel className="p-6">
            <EmptyState
              icon={<Icons.notificationsMuted className="h-8 w-8" />}
              title={t('alerts.emptyTitle', 'No alerts')}
              message={t('alerts.noAlertsInRange', 'No alerts in this range. Your fleet is running smoothly.')}
              description={t(
                'alerts.noAlertsInRangeDescription',
                'Alert rules continue monitoring new telemetry and will surface actionable events here.',
              )}
              actionTo={{
                label: t('operations.alerts.manageRules', 'Manage rules'),
                to: '/notifications/studio',
              }}
            />
          </GlassPanel>
        ) : null}
      </FadeIn>

      {/* Insights bento — trend + type distribution + watchlist. Reflows
          1-col → 2-col (md) → 3-col (xl); each panel owns its own state. */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('alerts.insights', 'Alert insights')}
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 xl:gap-5"
        >
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Icons.notifications className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('Alert Trend (7 Days)')}
            </PanelTitle>
            <div className="h-48 sm:h-56">
              {isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : error ? (
                <EmptyState
                  icon={<Icons.notificationsMuted className="h-8 w-8" />}
                  title={t('operations.alerts.trendUnavailable', 'Trend unavailable')}
                  message={t('operations.alerts.feedUnavailableDetail', 'Restore the alert feed to review this analysis.')}
                  action={{ label: t('common.retry', 'Retry'), onClick: () => { void alertsQuery.refetch(); } }}
                />
              ) : weekAlertCount === 0 ? (
                <EmptyState
                  /* no-action: transient — no alert activity in the trailing 7-day window */
                  icon={<Icons.notifications className="h-8 w-8" />}
                  message={t('alerts.noTrend', 'No alert activity in the last 7 days.')}
                />
              ) : (
                <EmbeddedChart
                  title={t('Alert Trend (7 Days)')}
                  ariaLabel={t(
                    'alerts.trendAria',
                    'Alert counts by severity over the last seven days',
                  )}
                  data={alertsByDay}
                  dataColumns={[
                    { key: 'day', label: t('alerts.day', 'Day') },
                    { key: 'critical', label: t('Critical') },
                    { key: 'warning', label: t('Warning') },
                    { key: 'info', label: t('Info') },
                  ]}
                  chartKey="alerts-list-seven-day-trend"
                >
                  {({ hiddenSeries }) => (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={alertsByDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <ChartLegend />
                    <Bar dataKey="critical" name={t('Critical')} stackId="a" fill={SEVERITY_HEX.critical} fillOpacity={0.75} hide={hiddenSeries?.isHidden('critical')} />
                    <Bar dataKey="warning" name={t('Warning')} stackId="a" fill={SEVERITY_HEX.warning} fillOpacity={0.7} hide={hiddenSeries?.isHidden('warning')} />
                    <Bar dataKey="info" name={t('Info')} stackId="a" fill={SEVERITY_HEX.info} fillOpacity={0.6} radius={[4, 4, 0, 0]} hide={hiddenSeries?.isHidden('info')} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </EmbeddedChart>
              )}
            </div>
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Icons.filter className="h-4 w-4 text-purple-300" aria-hidden="true" />
              {t('Alerts by Type')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton className="h-48 w-full sm:h-56" />
            ) : error ? (
              <EmptyState
                icon={<Icons.filter className="h-8 w-8" />}
                title={t('operations.alerts.distributionUnavailable', 'Distribution unavailable')}
                message={t('operations.alerts.feedUnavailableDetail', 'Restore the alert feed to review this analysis.')}
                action={{ label: t('common.retry', 'Retry'), onClick: () => { void alertsQuery.refetch(); } }}
              />
            ) : alertsByType.length === 0 ? (
              <EmptyState
                /* no-action: transient — nothing to categorize until alerts arrive */
                icon={<Icons.filter className="h-8 w-8" />}
                message={t('alerts.noTypes', 'No alerts to categorize yet.')}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 sm:items-center">
                <EmbeddedChart
                  title={t('Alerts by Type')}
                  ariaLabel={t('alerts.typeDistributionAria', 'Alert distribution by type')}
                  data={alertsByType.map(({ name, value }) => ({ name, value }))}
                  dataColumns={[
                    { key: 'name', label: t('alerts.type', 'Alert type') },
                    { key: 'value', label: t('alerts.count', 'Alerts') },
                  ]}
                  fluid={false}
                  mobileHeight={160}
                  height={224}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={alertsByType} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2} dataKey="value">
                        {alertsByType.map((entry, i) => <Cell key={i} fill={entry.fill} stroke="transparent" />)}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </EmbeddedChart>
                <ul className="space-y-1.5">
                  {alertsByType.map((d, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: d.fill }} aria-hidden="true" />
                      <Text as="span" color="secondary" className="truncate">{d.name}</Text>
                      <Text as="span" mono color="primary" className="ml-auto">{d.value}</Text>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5 md:col-span-2 xl:col-span-1">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Icons.notifications className="h-4 w-4 text-amber-300" aria-hidden="true" />
              {t('pinned.section.watching', 'Watching')}
              {pinnedRules.length > 0 && (
                <Text as="span" size="xs" weight="regular" color="muted">({pinnedRules.length})</Text>
              )}
            </PanelTitle>
            {rulesQuery.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : rulesQuery.error ? (
              <QueryError
                error={rulesQuery.error}
                onRetry={() => { void rulesQuery.refetch(); }}
                resourceName={t('operations.alerts.rules', 'alert rules')}
              />
            ) : pinnedRules.length === 0 ? (
              <EmptyState
                /* no-action: user-curated watchlist is empty until a rule is pinned */
                icon={<Icons.notifications className="h-8 w-8" />}
                message={t('alerts.noWatching', 'Pin an alert rule to keep an eye on it here.')}
              />
            ) : (
              <ul className="divide-y divide-white/5">
                {pinnedRules.map(rule => (
                  <li key={rule.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Text as="span" size="sm" weight="medium" color="primary" className="truncate">{rule.name || `${t('alerts.rule', 'Rule')} #${rule.id}`}</Text>
                        {rule.enabled ? (
                          <Badge variant="success" size="sm">{t('common.enabled', 'Enabled')}</Badge>
                        ) : (
                          <Badge variant="neutral" size="sm">{t('common.disabled', 'Disabled')}</Badge>
                        )}
                      </div>
                    </div>
                    <PinButton itemType="alert_rule" itemId={rule.id} size="sm" />
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      <FadeIn delay={0.15}>
        <FilterBar>
          <SearchInput
            value={alertSearch}
            onChange={applySearch}
            placeholder={t('alerts.searchPlaceholder', 'Search by title or message…')}
            className="w-full sm:w-72"
            historyScope="alerts"
          />
          <div className="flex items-center gap-2" data-tour="alerts-filters">
            <Icons.filter className="h-4 w-4 text-[var(--text-muted)]" />
            <TabNav
              tabs={[
                { key: 'all', label: `${t('All')} (${totalCount})` },
                { key: 'open', label: `${t('operations.alerts.open', 'Open')} (${openCount})` },
                { key: 'acknowledged', label: `${t('operations.alerts.acknowledged', 'Acknowledged')} (${acknowledgedCount})` },
                { key: 'unread', label: `${t('Unread')} (${unreadCount})` },
                { key: 'critical', label: `${t('Critical')} (${criticalCount})` },
                {
                  key: 'open-critical',
                  label: `${t('operations.alerts.openCritical', 'Open critical')} (${openCriticalCount})`,
                },
              ]}
              active={filter}
              onChange={k => applyStatusFilter(k as AlertFilter)}
            />
          </div>
        </FilterBar>
        <ActiveFilterChips
          className="mt-3"
          filters={
            ([
              alertSearch
                ? {
                    key: 'q',
                    label: t('alerts.filterLabel.search', 'Search'),
                    value: alertSearch,
                    onRemove: () => applySearch(''),
                  } satisfies FilterChipDescriptor
                : null,
              filter !== 'all'
                ? {
                    key: 'filter',
                    label: t('alerts.filterLabel.status', 'Status'),
                    value:
                      filter === 'unread'
                        ? t('Unread')
                        : filter === 'open'
                          ? t('operations.alerts.open', 'Open')
                          : filter === 'acknowledged'
                            ? t('operations.alerts.acknowledged', 'Acknowledged')
                            : filter === 'open-critical'
                              ? t('operations.alerts.openCritical', 'Open critical')
                              : t('Critical'),
                    onRemove: () => applyStatusFilter('all'),
                  } satisfies FilterChipDescriptor
                : null,
            ].filter(Boolean) as FilterChipDescriptor[]) as readonly FilterChipDescriptor[]
          }
          onClearAll={clearAllFilters}
        />
      </FadeIn>

      {/* Alerts detail band — full-width list; reflows to two columns on 2xl+
          so ultra-wide monitors keep filling the width instead of a narrow strip. */}
      <FadeIn delay={0.2}>
        {isLoading ? (
          <div className="grid grid-cols-1 gap-2 2xl:grid-cols-2 2xl:gap-3">
            {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : error ? (
          <GlassPanel className="p-6">
            <EmptyState
              icon={<Icons.notificationsMuted className="h-8 w-8" />}
              title={t('operations.alerts.feedUnavailable', 'Alert feed unavailable')}
              message={t('operations.alerts.feedUnavailableDetail', 'Restore the alert feed to resume triage.')}
              action={{ label: t('common.retry', 'Retry'), onClick: () => { void alertsQuery.refetch(); } }}
            />
          </GlassPanel>
        ) : filteredAlerts.length > 0 ? (
          <div data-tour="alerts-list">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <Checkbox
                checked={bulkSelectionState === 'all'}
                indeterminate={bulkSelectionState === 'some'}
                onChange={() => bulkSelection.toggleAll(visibleAlertIds)}
                label={t('operations.alerts.bulk.selectVisible', 'Select visible alerts')}
              />
              <Text as="span" variant="caption">
                {t(
                  'operations.alerts.bulk.visibleCount',
                  '{{count}} alerts in the current view',
                  { count: filteredAlerts.length },
                )}
              </Text>
            </div>
            <BulkActionsToolbar
              selectedIds={Array.from(bulkSelection.selectedIds)}
              total={filteredAlerts.length}
              onClear={bulkSelection.clear}
              actions={bulkAlertActions}
              itemNoun={{
                one: t('operations.alerts.bulk.alertOne', 'alert'),
                other: t('operations.alerts.bulk.alertOther', 'alerts'),
              }}
            />
            <StaggerContainer className="grid grid-cols-1 gap-2 2xl:grid-cols-2 2xl:gap-3">
              {pagedAlerts.map(a => (
                <StaggerItem key={a.id}>
                  <AlertCard
                    alert={a}
                    onMarkRead={() => handleMarkRead(a.id)}
                    onAcknowledge={() => setAckDialogId(a.id)}
                    onReopen={() => handleReopen(a.id)}
                    onOpenDetail={() => setDetailId(a.id)}
                    selected={bulkSelection.isSelected(a.id)}
                    onToggleSelect={(selected) =>
                      bulkSelection.setSelected(a.id, selected)
                    }
                    t={t}
                  />
                </StaggerItem>
              ))}
            </StaggerContainer>

            {totalPages > 1 && (
              <Pagination
                page={safeAlertPage}
                pageSize={alertsPerPage}
                total={filteredAlerts.length}
                onPageChange={setAlertPage}
              />
            )}
          </div>
        ) : (
          <GlassPanel className="p-6">
            <EmptyState
              icon={<Icons.notificationsMuted className="h-8 w-8" />}
              title={t('alerts.emptyTitle', 'No alerts')}
              message={
                alertSearch
                  ? t('alerts.noSearchResults', 'No alerts match your search.')
                  : filter === 'all'
                    ? t(
                        'alerts.noAlerts',
                        'Your fleet is running smoothly. Alerts will appear here.',
                      )
                    : t('alerts.noneForFilter', 'No {{filter}} alerts right now.', { filter })
              }
              description={
                alertSearch
                  ? t(
                      'alerts.noSearchResultsDescription',
                      'Try a broader title or message search, or clear the search to restore all alerts.',
                    )
                  : filter !== 'all'
                    ? t(
                        'alerts.noneForFilterDescription',
                        'Clear the active filters to review alerts in every status.',
                      )
                    : t(
                        'alerts.noAlertsDescription',
                        'Configured rules continue monitoring incoming fleet telemetry.',
                      )
              }
              action={
                alertSearch
                  ? {
                      label: t('alerts.clearSearch', 'Clear search'),
                      onClick: () => applySearch(''),
                    }
                  : filter !== 'all'
                    ? {
                        label: t('alerts.clearFilters', 'Clear filters'),
                        onClick: clearAllFilters,
                      }
                    : undefined
              }
              actionTo={
                !alertSearch && filter === 'all'
                  ? {
                      label: t('operations.alerts.manageRules', 'Manage rules'),
                      to: '/notifications/studio',
                    }
                  : undefined
              }
            />
          </GlassPanel>
        )}
      </FadeIn>

      <AcknowledgeAlertDialog
        open={ackDialogId !== null}
        onClose={() => setAckDialogId(null)}
        onSubmit={handleAcknowledgeSubmit}
        submitting={ackMut.isPending}
        alertTitle={ackTarget?.title}
      />
      <AlertDetailDrawer
        alert={detailTarget}
        detail={detailQuery.data}
        isLoading={detailQuery.isLoading}
        error={detailQuery.error}
        vehicleName={
          detailTarget?.vehicle_id === vehicleId
            ? vehicle?.display_name || vehicle?.vin
            : null
        }
        onClose={() => setDetailId(null)}
        onAcknowledge={(id) => {
          setDetailId(null);
          setAckDialogId(id);
        }}
        onReopen={(id) => {
          setDetailId(null);
          handleReopen(id);
        }}
        onRetry={() => { void detailQuery.refetch(); }}
      />
    </PageContainer>
  );
}
