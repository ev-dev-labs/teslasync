/**
 * InboxBody — shared notification-log inbox surface.
 *
 * Owns:
 *   - URL-backed filter + view state (severity, vehicle, rule, search,
 *     read state, from/to, view mode)
 *   - Bulk selection + bulk actions (mark read, archive/restore, delete)
 *   - Auto-mark-read on open (opt-out via localStorage)
 *   - Per-row context menu (view context, mark read/unread, archive/restore,
 *     delete)
 *   - Day-grouped flat list AND threaded grouped list
 *
 * Used by InboxPage (`archived=false`) and ArchivedPage (`archived=true`).
 * Was previously an inner component of the now-removed NotificationsPage.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useCallback,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  Bell,
  MailOpen,
  Mail,
  Trash2,
  CheckCheck,
  Layers,
  List,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Button,
  Checkbox,
  GlassPanel,
  useContextMenu,
  type ContextMenuItem,
} from '@/components/ui';
import { BulkActionsToolbar, type BulkAction } from '@/components/data-display';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { useToast } from '@/components/feedback/Toast';
import { FadeIn } from '@/components/motion/FadeIn';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { useAnnouncer } from '@/hooks/useAnnouncer';
import { useRangeState } from '@/hooks/useRangeState';
import { useUrlEnum, useUrlString, useUrlArray, useUrlBatch } from '@/hooks/useUrlState';
import {
  useNotificationLogs,
  useNotificationGroups,
  useArchiveNotifications,
  useUnarchiveNotifications,
  useMarkNotificationsRead,
  useMarkNotificationsUnread,
  useBulkMarkRead,
  useDeleteNotifications,
  type NotificationFilters,
} from '@/api/hooks/useNotifications';
import type { NotificationLog, AlertRule, Vehicle, Alert } from '@/api/types';
import { getAlertDrillthroughHref } from '@/lib/alertDrillthrough';
import { NotificationFilterBar } from './NotificationFilterBar';
import { AIInboxAutoCategorization } from '@/components/ai/AIInboxAutoCategorization';
import { NotificationRow } from './NotificationRow';
import { NotificationGroupRow } from './NotificationGroupRow';
import { PullToRefresh, SwipeRow } from '@/components/mobile';

const SEVERITY_VALUES = ['info', 'warn', 'critical'] as const;
type SeverityValue = (typeof SEVERITY_VALUES)[number];

const READ_VALUES = ['all', 'read', 'unread'] as const;
type ReadValue = (typeof READ_VALUES)[number];

// Grouped/threaded vs flat inbox view. Default
// is grouped because power users with many alert rules drown in flat
// duplicates; flat remains available for the historical workflow and
// for users who want to see every individual delivery.
const VIEW_VALUES = ['grouped', 'flat'] as const;
type ViewValue = (typeof VIEW_VALUES)[number];

const PREF_MARK_ON_OPEN = 'teslasync.notifications.markOnOpen';
const PREF_MARK_ON_CLICK = 'teslasync.notifications.markOnClick';

function readPref(key: string): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const v = window.localStorage.getItem(key);
    if (v == null) return true;
    return v !== 'false';
  } catch {
    return true;
  }
}

/**
 * Group ISO timestamps into "Today" / "Yesterday" / dated buckets keyed by
 * the user's local day. Rows are returned in the order they came in (newest
 * first); the day grouping just adds headers.
 */
function groupByDay<T extends { created_at: string }>(rows: T[]): { day: string; rows: T[] }[] {
  if (rows.length === 0) return [];
  const fmt = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const labelFor = (d: Date): string => {
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    if (day.getTime() === today.getTime()) return 'Today';
    if (day.getTime() === yesterday.getTime()) return 'Yesterday';
    return fmt.format(d);
  };

  const out: { day: string; rows: T[] }[] = [];
  let current: { day: string; rows: T[] } | null = null;
  for (const row of rows) {
    const d = new Date(row.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const label = labelFor(d);
    if (!current || current.day !== label) {
      current = { day: label, rows: [] };
      out.push(current);
    }
    current.rows.push(row);
  }
  return out;
}

export interface InboxBodyProps {
  archived: boolean;
  vehicles: Vehicle[];
  rules: AlertRule[];
}

export function InboxBody({ archived, vehicles, rules }: InboxBodyProps) {
  const { t } = useTranslation();

  // ── URL-backed filter state ─────────────────────
  // Severity, vehicle, search, and read-state live in the URL so a filtered
  // view can be shared / reloaded / linked from outside.
  const [severityRaw] = useUrlArray('severity');
  const [vehicleIdsRaw] = useUrlArray('vehicle_id');
  const [ruleIdsRaw] = useUrlArray('rule_id');
  const [search] = useUrlString('q', '');
  const [readState] = useUrlEnum<ReadValue>('read', READ_VALUES, 'all');
  const {
    start: from,
    end: to,
    setRange: setDateRange,
    setRangeWithUrlUpdates,
    resetWithUrlUpdates: resetRangeWithUrlUpdates,
  } = useRangeState({
    persistKey: 'notifications.inbox.range',
  });
  // View mode is URL-backed too so a deep link can
  // express "Inbox, grouped" vs "Inbox, flat" independent of filter state.
  const [view, setView] = useUrlEnum<ViewValue>('view', VIEW_VALUES, 'grouped');
  const setFiltersBatch = useUrlBatch();
  const isGrouped = view === 'grouped' && !archived;

  // Sanitize unknown severity values so a hand-edited URL can't corrupt the
  // request payload.
  const severity = useMemo<SeverityValue[]>(
    () => severityRaw.filter((s): s is SeverityValue => SEVERITY_VALUES.includes(s as SeverityValue)),
    [severityRaw],
  );
  const vehicleIds = useMemo<number[]>(() => {
    return vehicleIdsRaw
      .map(v => Number(v))
      .filter(n => Number.isFinite(n) && n > 0);
  }, [vehicleIdsRaw]);
  const ruleIds = useMemo<number[]>(() => {
    return ruleIdsRaw
      .map(v => Number(v))
      .filter(n => Number.isFinite(n) && n > 0);
  }, [ruleIdsRaw]);

  const filters = useMemo<NotificationFilters>(() => ({
    archived,
    severity: severity.length ? severity : undefined,
    vehicle_id: vehicleIds.length ? vehicleIds : undefined,
    rule_id: ruleIds.length ? ruleIds : undefined,
    q: search || undefined,
    from: from || undefined,
    to: to || undefined,
    read: readState === 'all' ? undefined : readState === 'read',
  }), [archived, severity, vehicleIds, ruleIds, search, from, to, readState]);

  const handleFiltersChange = useCallback((next: NotificationFilters) => {
    // Bridge the existing controlled-component contract back into the
    // discrete URL params so the FilterBar UI stays untouched. All seven
    // keys are written atomically via useUrlBatch — without this, the
    // react-router-dom v6 setSearchParams race would discard 6 of 7
    // updates whenever a saved view applied multi-key filters.
    const readValue =
      next.read === undefined ? null : next.read ? 'read' : 'unread';
    const urlUpdates = {
      severity: (next.severity ?? []).join(',') || null,
      vehicle_id: (next.vehicle_id ?? []).map(String).join(',') || null,
      rule_id: (next.rule_id ?? []).map(String).join(',') || null,
      q: next.q ?? null,
      read: readValue,
    };
    const nextFrom = next.from?.slice(0, 10);
    const nextTo = next.to?.slice(0, 10);
    if (!nextFrom || !nextTo) {
      resetRangeWithUrlUpdates(urlUpdates);
      return;
    }
    if (nextFrom !== from || nextTo !== to) {
      setRangeWithUrlUpdates(
        { start: nextFrom, end: nextTo },
        urlUpdates,
      );
      return;
    }
    setFiltersBatch(urlUpdates);
  }, [
    from,
    resetRangeWithUrlUpdates,
    setFiltersBatch,
    setRangeWithUrlUpdates,
    to,
  ]);

  // Inbox auto-categorization apply callback.
  // The AI panel's "Apply categories as filter" button passes a
  // deduped rule_id list back to the inbox; we copy it into the
  // existing URL-backed rule_id filter so the deterministic
  // baseline NotificationFilterBar / useNotificationLogs path
  // narrows the list. The AI component itself NEVER persists
  // state — this callback is the canonical hand-off into the
  // baseline filter (ADR-015 §I3 + §I8 propose-only contract).
  const handleApplyAICategories = useCallback((newRuleIds: number[]) => {
    setFiltersBatch({
      rule_id: newRuleIds.map(String).join(',') || null,
    });
  }, [setFiltersBatch]);

  const { data: rawRows, isLoading, error, refetch } = useNotificationLogs(filters, { enabled: !isGrouped });
  const rows = useMemo<NotificationLog[]>(() => rawRows ?? [], [rawRows]);

  // Grouped/threaded fetch. Only enabled in
  // grouped mode AND on the inbox tab (archived doesn't group; the
  // archive workflow is row-by-row triage).
  const {
    data: rawGroups,
    isLoading: groupsLoading,
    error: groupsError,
    refetch: groupsRefetch,
  } = useNotificationGroups(filters, { enabled: isGrouped });
  const groups = useMemo(() => rawGroups ?? [], [rawGroups]);
  const groupedDeliveryCount = useMemo(
    () => groups.reduce((total, group) => total + Math.max(0, group.count), 0),
    [groups],
  );

  const ruleMap = useMemo<Record<number, AlertRule>>(() => {
    const m: Record<number, AlertRule> = {};
    rules.forEach(r => { m[r.id] = r; });
    return m;
  }, [rules]);
  const vehicleMap = useMemo<Record<number, Vehicle>>(() => {
    const m: Record<number, Vehicle> = {};
    vehicles.forEach(v => { m[v.id] = v; });
    return m;
  }, [vehicles]);

  const markReadMut = useMarkNotificationsRead();
  const markUnreadMut = useMarkNotificationsUnread();
  const bulkMarkReadMut = useBulkMarkRead();
  const archiveMut = useArchiveNotifications();
  const unarchiveMut = useUnarchiveNotifications();
  const deleteMut = useDeleteNotifications();
  const toast = useToast();
  const { announce } = useAnnouncer();

  // Auto-mark-read on inbox open (only on the Inbox tab, flat view; in
  // grouped view this would dismiss every thread head and defeat the
  // purpose of the user-driven "Mark group read" affordance).
  const autoMarkedRef = useRef(false);
  useEffect(() => {
    if (archived) return;
    if (isGrouped) return;
    if (autoMarkedRef.current) return;
    if (isLoading) return;
    if (!readPref(PREF_MARK_ON_OPEN)) return;
    const unread = rows.filter(r => !r.read_at).map(r => r.id);
    if (unread.length === 0) return;
    autoMarkedRef.current = true;
    markReadMut.mutate(unread);
  }, [archived, isLoading, rows, markReadMut, isGrouped]);

  // Generic bulk-selection helper replaces hand-rolled Set<number> state.
  const bulkSelection = useBulkSelection<number>();
  const selected = bulkSelection.selectedIds;
  const clearSelection = bulkSelection.clear;
  const toggleSelected = useCallback(
    (id: number, on: boolean) => bulkSelection.setSelected(id, on),
    [bulkSelection],
  );
  const visibleIds = useMemo(() => rows.map(r => r.id), [rows]);
  const selectAllVisible = useCallback(
    () => bulkSelection.selectAll(visibleIds),
    [bulkSelection, visibleIds],
  );
  // Derive the master-checkbox tri-state once so the header checkbox can
  // reflect the "some but not all visible rows selected" case as a native
  // `indeterminate` control instead of silently showing an unchecked box.
  const visibleSelectionState = bulkSelection.masterState(visibleIds);
  const allVisibleSelected = visibleSelectionState === 'all';
  const someVisibleSelected = visibleSelectionState === 'some';
  // Drop selections when filter changes — selection should never carry over
  // across a different result set.
  useEffect(() => { clearSelection(); }, [filters, clearSelection]);

  const grouped = useMemo(() => groupByDay(rows), [rows]);

  const unreadCount = useMemo(
    () => rows.reduce((acc, r) => (r.read_at ? acc : acc + 1), 0),
    [rows],
  );

  const handleBulkArchive = useCallback(async (ids: Array<string | number>) => {
    await archiveMut.mutateAsync(ids.map(Number));
    clearSelection();
    announce(
      t('notifications.bulk.announceArchived', '{{count}} items archived', {
        count: ids.length,
      }),
    );
  }, [archiveMut, announce, clearSelection, t]);
  const handleBulkUnarchive = useCallback(async (ids: Array<string | number>) => {
    await unarchiveMut.mutateAsync(ids.map(Number));
    clearSelection();
    announce(
      t('notifications.bulk.announceRestored', '{{count}} items restored', {
        count: ids.length,
      }),
    );
  }, [unarchiveMut, announce, clearSelection, t]);
  const handleBulkMarkRead = useCallback(async (ids: Array<string | number>) => {
    const numericIds = ids.map(Number);
    try {
      await bulkMarkReadMut.mutateAsync({ ids: numericIds });
    } catch (e) {
      toast.error(
        t('toast.notifications.markRead.error', 'Failed to mark as read'),
        e instanceof Error ? e.message : undefined,
      );
      return;
    }
    clearSelection();
    toast.toast({
      type: 'success',
      title: t('notifications.bulkRead.success', '{{count}} marked as read', {
        count: numericIds.length,
      }),
      duration: 5000,
      action: {
        label: t('common.undo', 'Undo'),
        onClick: () => { markUnreadMut.mutate(numericIds); },
      },
    });
  }, [bulkMarkReadMut, markUnreadMut, toast, t, clearSelection]);
  const handleMarkAllRead = useCallback(async () => {
    if (unreadCount === 0) return;
    const visibleUnreadIds = rows.filter(r => !r.read_at).map(r => r.id);
    try {
      await bulkMarkReadMut.mutateAsync({ all: true });
    } catch (e) {
      toast.error(
        t('toast.notifications.markRead.error', 'Failed to mark as read'),
        e instanceof Error ? e.message : undefined,
      );
      return;
    }
    clearSelection();
    toast.toast({
      type: 'success',
      title: t('notifications.markAllRead.success', 'All notifications marked as read'),
      duration: 5000,
      action: visibleUnreadIds.length > 0
        ? {
            label: t('common.undo', 'Undo'),
            onClick: () => { markUnreadMut.mutate(visibleUnreadIds); },
          }
        : undefined,
    });
  }, [bulkMarkReadMut, markUnreadMut, toast, t, rows, unreadCount, clearSelection]);
  const handleBulkDelete = useCallback(async (ids: Array<string | number>) => {
    await deleteMut.mutateAsync(ids.map(Number));
    clearSelection();
  }, [deleteMut, clearSelection]);

  const bulkActions = useMemo<BulkAction[]>(() => {
    const list: BulkAction[] = [];
    if (!archived) {
      list.push({
        id: 'mark-read',
        label: t('notifications.inbox.bulk.markRead', 'Mark read'),
        icon: <MailOpen className="h-3.5 w-3.5" />,
        onClick: handleBulkMarkRead,
      });
      list.push({
        id: 'archive',
        label: t('notifications.inbox.bulk.archive', 'Archive'),
        icon: <Archive className="h-3.5 w-3.5" />,
        onClick: handleBulkArchive,
      });
    }
    if (archived) {
      list.push({
        id: 'restore',
        label: t('notifications.inbox.bulk.restore', 'Restore'),
        icon: <ArchiveRestore className="h-3.5 w-3.5" />,
        onClick: handleBulkUnarchive,
      });
    }
    list.push({
      id: 'delete',
      label: t('bulk.actions.delete', 'Delete'),
      icon: <Trash2 className="h-3.5 w-3.5" />,
      variant: 'danger',
      confirm: {
        title: t('notifications.inbox.bulk.deleteConfirmTitle', 'Delete notifications?'),
        description: t(
          'notifications.inbox.bulk.deleteConfirmBody',
          'These notifications will be permanently removed. Archive is usually the safer choice.',
        ),
        confirmLabel: t('common.delete', 'Delete'),
      },
      onClick: handleBulkDelete,
    });
    return list;
  }, [archived, t, handleBulkArchive, handleBulkUnarchive, handleBulkMarkRead, handleBulkDelete]);

  const handleRowActivate = (log: NotificationLog) => {
    if (log.read_at) return;
    if (!readPref(PREF_MARK_ON_CLICK)) return;
    markReadMut.mutate([log.id]);
  };

  const navigate = useNavigate();
  const { openMenu: openRowContextMenu } = useContextMenu();
  const buildRowContextMenu = useCallback(
    (log: NotificationLog): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [];
      const rule = log.alert_id != null ? ruleMap[log.alert_id] : undefined;
      const vehicle = log.alert_id != null && rule?.vehicle_id != null
        ? vehicleMap[rule.vehicle_id]
        : undefined;
      const isRead = !!log.read_at;
      const isArchived = !!log.archived_at;
      if (!isRead) {
        items.push({
          id: 'mark-read',
          label: t('notifications.inbox.row.markRead', 'Mark as read'),
          icon: <MailOpen className="h-3.5 w-3.5" aria-hidden="true" />,
          onClick: () => markReadMut.mutate([log.id]),
        });
      } else {
        items.push({
          id: 'mark-unread',
          label: t('notifications.inbox.row.markUnread', 'Mark as unread'),
          icon: <Mail className="h-3.5 w-3.5" aria-hidden="true" />,
          onClick: () => markUnreadMut.mutate([log.id]),
        });
      }
      if (!isArchived) {
        items.push({
          id: 'archive',
          label: t('notifications.inbox.row.archive', 'Archive'),
          icon: <Archive className="h-3.5 w-3.5" aria-hidden="true" />,
          onClick: () => archiveMut.mutate([log.id]),
        });
      } else {
        items.push({
          id: 'restore',
          label: t('notifications.inbox.row.unarchive', 'Restore'),
          icon: <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />,
          onClick: () => unarchiveMut.mutate([log.id]),
        });
      }
      if (rule) {
        const synthetic: Alert = {
          id: log.id,
          vehicle_id: vehicle?.id ?? rule.vehicle_id ?? 0,
          type: rule.name ?? log.title,
          severity: (rule.severity ?? 'info') as Alert['severity'],
          title: log.title,
          message: log.message,
          is_read: isRead,
          created_at: log.created_at,
          rule_id: rule.id,
          rule_signal: rule.signal_name,
          rule_severity: rule.severity,
        };
        const href = getAlertDrillthroughHref(synthetic);
        if (href) {
          items.push({
            id: 'view-context',
            label: t('alerts.viewContext', 'View context'),
            icon: <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />,
            onClick: () => navigate(href),
          });
        }
      }
      items.push({
        id: 'delete',
        label: t('common.delete', 'Delete'),
        icon: <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />,
        destructive: true,
        onClick: () => deleteMut.mutate([log.id]),
      });
      return items;
    },
    [ruleMap, vehicleMap, t, archiveMut, unarchiveMut, markReadMut, markUnreadMut, deleteMut, navigate],
  );
  const handleRowContextMenu = useCallback(
    (log: NotificationLog) =>
      (e: ReactMouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        if (target.closest('input, textarea, select, a, button')) return;
        const items = buildRowContextMenu(log);
        if (items.length === 0) return;
        e.preventDefault();
        openRowContextMenu(items, e.clientX, e.clientY);
      },
    [buildRowContextMenu, openRowContextMenu],
  );

  return (
    <PullToRefresh onRefresh={async () => { await (isGrouped ? groupsRefetch() : refetch()); }}>
    <div className="space-y-4">
      <FadeIn>
        <NotificationFilterBar
          filters={filters}
          onChange={handleFiltersChange}
          onRangeChange={setDateRange}
          vehicles={vehicles}
          rules={rules}
        />
      </FadeIn>

      {/* Inbox auto-categorization. The
        component is wrapped with withAiFeature, so it is ABSENT
        when ai_mode='off' OR the per-feature toggle is off
        (ADR-015 §I5). The "Apply categories as filter" callback
        narrows the existing URL-backed rule_id filter — the AI
        never persists state directly. */}
      <AIInboxAutoCategorization
        vehicleId={vehicleIds.length === 1 ? vehicleIds[0] : null}
        severities={severity}
        ruleIds={ruleIds}
        onApplyCategories={handleApplyAICategories}
      />

      <BulkActionsToolbar
        selectedIds={Array.from(selected)}
        total={rows.length}
        onClear={clearSelection}
        actions={bulkActions}
        itemNoun={{
          one: t('bulk.noun.notification_one', 'notification'),
          other: t('bulk.noun.notification_other', 'notifications'),
        }}
      />

      <GlassPanel className="p-3 sm:p-4">
        <div className="mb-2 flex items-center gap-3 px-1 pb-2 border-b border-white/[0.04]">
          {!isGrouped && (
            <Checkbox
              checked={allVisibleSelected}
              indeterminate={someVisibleSelected}
              onChange={checked => (checked ? selectAllVisible() : clearSelection())}
              aria-label={t('notifications.inbox.selectAll', 'Select all visible')}
            />
          )}
          <span
            className="text-xs text-[var(--text-muted)]"
            data-testid="inbox-result-count"
          >
            {isGrouped ? (
              <>
                {t('notifications.inbox.threadCountLabel', '{{count}} threads', {
                  count: groups.length,
                })}
                <span aria-hidden="true"> · </span>
                {t('notifications.inbox.deliveryCountLabel', '{{count}} deliveries', {
                  count: groupedDeliveryCount,
                })}
              </>
            ) : (
              t('notifications.inbox.countLabel', '{{count}} notifications', { count: rows.length })
            )}
          </span>
          {!archived && (
            <div
              className="ml-auto flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.02] p-0.5"
              role="group"
              aria-label={t('notifications.view.label', 'View')}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setView('grouped')}
                aria-pressed={view === 'grouped'}
                aria-label={t('notifications.view.grouped', 'Grouped')}
                className={cn(
                  'h-auto rounded-full px-2 py-1',
                  view === 'grouped'
                    ? 'bg-cyan-400/15 text-cyan-200'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
                )}
                data-testid="view-toggle-grouped"
              >
                <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">
                  {t('notifications.view.grouped', 'Grouped')}
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setView('flat')}
                aria-pressed={view === 'flat'}
                aria-label={t('notifications.view.flat', 'Flat')}
                className={cn(
                  'h-auto rounded-full px-2 py-1',
                  view === 'flat'
                    ? 'bg-cyan-400/15 text-cyan-200'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
                )}
                data-testid="view-toggle-flat"
              >
                <List className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">
                  {t('notifications.view.flat', 'Flat')}
                </span>
              </Button>
            </div>
          )}
          {!archived && !isGrouped && unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkAllRead}
              disabled={bulkMarkReadMut.isPending}
              icon={<CheckCheck className="h-3.5 w-3.5" />}
              className="text-xs"
              aria-label={t('notifications.markAllRead.action', 'Mark all read')}
            >
              {t('notifications.markAllRead.action', 'Mark all read')}
            </Button>
          )}
        </div>

        {((isGrouped && groupsLoading) || (!isGrouped && isLoading)) && (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-14" />)}
          </div>
        )}

        {!isGrouped && !isLoading && error && (
          <EmptyState
            icon={<Bell className="h-8 w-8" />}
            title={t('notifications.inbox.error.title', 'Could not load notifications')}
            message={String(error)}
            action={{
              label: t('common.retry', 'Retry'),
              onClick: () => { void refetch(); },
            }}
          />
        )}

        {isGrouped && !groupsLoading && groupsError && (
          <EmptyState
            icon={<Bell className="h-8 w-8" />}
            title={t('notifications.inbox.error.title', 'Could not load notifications')}
            message={String(groupsError)}
            action={{
              label: t('common.retry', 'Retry'),
              onClick: () => { void groupsRefetch(); },
            }}
          />
        )}

        {!isGrouped && !isLoading && !error && grouped.length === 0 && (
          <EmptyState
            icon={<Bell className="h-8 w-8" />}
            title={archived
              ? t('notifications.inbox.empty.archivedTitle', 'No archived notifications')
              : t('notifications.inbox.empty.title', 'No notifications')}
            message={archived
              ? t('notifications.inbox.empty.archivedMessage', 'Archived notifications will appear here.')
              : t('notifications.inbox.empty.message', 'When alert rules fire, the resulting notifications appear here.')}
            actionTo={archived ? undefined : {
              label: t('notifications.inbox.empty.cta', 'Configure alert rules'),
              to: '/notifications/studio',
            }}
          />
        )}

        {isGrouped && !groupsLoading && !groupsError && groups.length === 0 && (
          <EmptyState
            icon={<Bell className="h-8 w-8" />}
            title={t('notifications.group.emptyTitle', 'No notification threads')}
            message={t('notifications.group.emptyMessage', 'When alert rules fire repeatedly, related notifications will be grouped here.')}
            actionTo={{
              label: t('notifications.inbox.empty.cta', 'Configure alert rules'),
              to: '/notifications/studio',
            }}
          />
        )}

        {!isGrouped && !isLoading && !error && grouped.length > 0 && (
          <div className="space-y-4">
            {grouped.map(group => (
              <div key={group.day}>
                <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  {group.day === 'Today'
                    ? t('common.today', 'Today')
                    : group.day === 'Yesterday'
                      ? t('common.yesterday', 'Yesterday')
                      : group.day}
                </div>
                <div className="space-y-1">
                  {group.rows.map(log => (
                    <SwipeRow
                      key={log.id}
                      rightAction={!archived
                        ? {
                            label: t('mobile.swipe.archive', 'Archive'),
                            onAction: () => archiveMut.mutate([log.id]),
                            tone: 'default',
                          }
                        : {
                            label: t('mobile.swipe.restore', 'Restore'),
                            onAction: () => unarchiveMut.mutate([log.id]),
                            tone: 'default',
                          }}
                    >
                      <div onContextMenu={handleRowContextMenu(log)}>
                        <NotificationRow
                          log={log}
                          rule={log.alert_id != null ? ruleMap[log.alert_id] : undefined}
                          vehicle={log.alert_id != null && ruleMap[log.alert_id]?.vehicle_id != null
                            ? vehicleMap[ruleMap[log.alert_id]!.vehicle_id!]
                            : undefined}
                          selected={selected.has(log.id)}
                          onSelectionChange={toggleSelected}
                          onActivate={handleRowActivate}
                          onArchive={!archived ? (id) => archiveMut.mutate([id]) : undefined}
                          onUnarchive={archived ? (id) => unarchiveMut.mutate([id]) : undefined}
                          onMarkRead={!log.read_at ? (id) => markReadMut.mutate([id]) : undefined}
                          onMarkUnread={log.read_at ? (id) => markUnreadMut.mutate([id]) : undefined}
                        />
                      </div>
                    </SwipeRow>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {isGrouped && !groupsLoading && !groupsError && groups.length > 0 && (
          <div className="space-y-2" data-testid="notification-groups">
            {groups.map((g, idx) => (
              <div
                key={g.group_key ?? `singleton:${g.latest.id}:${idx}`}
                onContextMenu={handleRowContextMenu(g.latest)}
              >
                <NotificationGroupRow
                  group={g}
                  ruleMap={ruleMap}
                  vehicleMap={vehicleMap}
                  filters={filters}
                  archived={archived}
                  selectedIds={selected}
                  onSelectionChange={toggleSelected}
                  onActivate={handleRowActivate}
                  onArchive={(id) => archiveMut.mutate([id])}
                  onUnarchive={archived ? (id) => unarchiveMut.mutate([id]) : undefined}
                  onMarkRead={(id) => markReadMut.mutate([id])}
                  onMarkUnread={(id) => markUnreadMut.mutate([id])}
                />
              </div>
            ))}
          </div>
        )}
      </GlassPanel>
    </div>
    </PullToRefresh>
  );
}

export default InboxBody;
