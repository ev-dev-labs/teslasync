/**
 * NotificationsPage — three-tab notifications hub.
 *
 *   Inbox     — non-archived notification log entries with filter, search,
 *               bulk select/archive/mark-read, and day grouping.
 *   Archived  — same shape but scoped to archived rows; bulk Restore.
 *   Channels  — extracted CRUD for delivery destinations (Discord, Slack…).
 *
 * The inbox tab also implements two opt-in auto-mark-read policies, controlled
 * by client-side localStorage preferences (defaults on):
 *   - mark all visible rows as read when the inbox is opened
 *   - mark a row as read when it is clicked
 *
 * These defaults can be overridden by writing the keys
 * `teslasync.notifications.markOnOpen` / `teslasync.notifications.markOnClick`
 * to localStorage with the value 'false'. A future Settings page can surface
 * them as toggles without changing this file's contract.
 *
 * deferred-filter:no server-driven — filter state (severity, vehicle, rule,
 * search, read, from/to) is forwarded to `useNotificationLogs(filters)` and
 * the API returns the matching rows. A client-side `useDeferredValue` would
 * be redundant: the heavy work happens server-side and the network round-trip
 * is already an asynchronous gap that lets the input stay responsive.
 */

import { useEffect, useMemo, useRef, useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Archive, ArchiveRestore, Bell, MailOpen, Mail, Trash2, CheckCheck, Layers, List, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';
import { PageContainer } from '@/components/layout';
import { Button, GlassPanel, TabNav, useContextMenu, type ContextMenuItem } from '@/components/ui';
import { BulkActionsToolbar, type BulkAction } from '@/components/data-display';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { useToast } from '@/components/feedback/Toast';
import { FadeIn } from '@/components/motion/FadeIn';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { useAnnouncer } from '@/hooks/useAnnouncer';
import { useUrlEnum, useUrlString, useUrlArray, useUrlBatch } from '@/hooks/useUrlState';
import { useVehicles } from '@/api/hooks/useVehicles';
import {
  useAlertRules,
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
import { NotificationFilterBar } from '../components/NotificationFilterBar';
import { NotificationRow } from '../components/NotificationRow';
import { NotificationGroupRow } from '../components/NotificationGroupRow';
import { NotificationChannelsView } from '../components/NotificationChannelsView';
import { PullToRefresh, SwipeRow } from '@/components/mobile';

type InboxTab = 'inbox' | 'archived' | 'channels';

const INBOX_TABS = ['inbox', 'archived', 'channels'] as const satisfies readonly InboxTab[];

const SEVERITY_VALUES = ['info', 'warn', 'critical'] as const;
type SeverityValue = (typeof SEVERITY_VALUES)[number];

const READ_VALUES = ['all', 'read', 'unread'] as const;
type ReadValue = (typeof READ_VALUES)[number];

// Phase-46 / Prompt 27 — grouped/threaded vs flat inbox view. Default
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

interface InboxBodyProps {
  archived: boolean;
  vehicles: Vehicle[];
  rules: AlertRule[];
}

function InboxBody({ archived, vehicles, rules }: InboxBodyProps) {
  const { t } = useTranslation();

  // ── URL-backed filter state (Phase 40 / Prompt 33) ─────────────────────
  // Severity, vehicle, search, and read-state live in the URL so a filtered
  // view can be shared / reloaded / linked from outside.
  const [severityRaw] = useUrlArray('severity');
  const [vehicleIdsRaw] = useUrlArray('vehicle_id');
  const [ruleIdsRaw] = useUrlArray('rule_id');
  const [search] = useUrlString('q', '');
  const [readState] = useUrlEnum<ReadValue>('read', READ_VALUES, 'all');
  const [from] = useUrlString('from', '');
  const [to] = useUrlString('to', '');
  // Phase-46 / Prompt 27 — view mode is URL-backed too so a deep link can
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
    setFiltersBatch({
      severity: (next.severity ?? []).join(',') || null,
      vehicle_id: (next.vehicle_id ?? []).map(String).join(',') || null,
      rule_id: (next.rule_id ?? []).map(String).join(',') || null,
      q: next.q ?? null,
      from: next.from ?? null,
      to: next.to ?? null,
      read: readValue,
    });
  }, [setFiltersBatch]);

  const { data: rawRows, isLoading, error, refetch } = useNotificationLogs(filters, { enabled: !isGrouped });
  const rows = useMemo<NotificationLog[]>(() => rawRows ?? [], [rawRows]);

  // Phase-46 / Prompt 27 — grouped/threaded fetch. Only enabled in
  // grouped mode AND on the inbox tab (archived doesn't group; the
  // archive workflow is row-by-row triage).
  const {
    data: rawGroups,
    isLoading: groupsLoading,
    error: groupsError,
    refetch: groupsRefetch,
  } = useNotificationGroups(filters, { enabled: isGrouped });
  const groups = useMemo(() => rawGroups ?? [], [rawGroups]);

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

  // Phase-45 / Prompt 32 — generic bulk-selection helper replaces the
  // hand-rolled Set<number> state from Phase-45 / 28. The hook owns the
  // selection; we expose the same `selected`/`toggleSelected`/`clearSelection`
  // / `selectAllVisible` accessors so the rest of the page (NotificationRow
  // props, BulkActionsToolbar, header checkbox) stays untouched.
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
  const allVisibleSelected = bulkSelection.masterState(visibleIds) === 'all';
  // Drop selections when filter changes — selection should never carry over
  // across a different result set.
  useEffect(() => { clearSelection(); }, [filters, clearSelection]);

  const grouped = useMemo(() => groupByDay(rows), [rows]);

  // Visible-row unread count drives both the "Mark all read" header
  // affordance and the (n) suffix on the toast that follows the action.
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
  // Bulk mark-read: optimistically flip the selected rows, then surface a
  // toast with an Undo button that reverses the mutation. If the original
  // mutation rejects, the optimistic helper rolls back the cache and we
  // emit the standard error toast — never a phantom "Marked as read" we'd
  // then have to take back.
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
      // 5s window to undo, matching the prompt's UX contract — long enough
      // for a "wait, no" reaction, short enough not to clutter the screen.
      duration: 5000,
      action: {
        label: t('common.undo', 'Undo'),
        onClick: () => { markUnreadMut.mutate(numericIds); },
      },
    });
  }, [bulkMarkReadMut, markUnreadMut, toast, t]);
  // "Mark all read" header action — hits the all=true backend path so the
  // server (not the client) decides which rows are affected. Avoids the
  // 1000-id cap and removes the need to enumerate every cached id.
  const handleMarkAllRead = useCallback(async () => {
    if (unreadCount === 0) return;
    // Snapshot the currently-visible unread ids so Undo can restore exactly
    // what the user just dismissed (Undo on a server-side "all" mutation
    // with no client knowledge would be impossible to bound otherwise).
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
  }, [bulkMarkReadMut, markUnreadMut, toast, t, rows, unreadCount]);
  const handleBulkDelete = useCallback(async (ids: Array<string | number>) => {
    await deleteMut.mutateAsync(ids.map(Number));
    clearSelection();
  }, [deleteMut]);

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

  // Phase-46 / Prompt 30 — right-click on a notification row surfaces
  // mark-read / archive / view-context actions via the shared
  // <ContextMenuRoot/>. Exposing these as a context menu means the inbox
  // doesn't need to render hover-only icons on every row to advertise
  // them — they remain reachable but visually quiet by default.
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
        // Allow native menus on form controls / links / buttons inside the row.
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
          vehicles={vehicles}
          rules={rules}
        />
      </FadeIn>

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
        {/* Select-all row + Mark-all-read header action. The header action
            sits opposite the count so it stays out of the way of the
            primary checkbox affordance and only reveals itself on the
            inbox tab when there's something to mark.
            Phase-46/27 — when in grouped mode, the per-row select-all
            checkbox is hidden because group rows aren't individually
            selectable; the user toggles the view first to bulk-select. */}
        <div className="mb-2 flex items-center gap-3 px-1 pb-2 border-b border-white/[0.04]">
          {!isGrouped && (
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={e => (e.target.checked ? selectAllVisible() : clearSelection())}
              aria-label={t('notifications.inbox.selectAll', 'Select all visible')}
              className="h-4 w-4 cursor-pointer rounded border-[var(--border-strong)] bg-white/[0.04] text-cyan-500 focus:ring-2 focus:ring-cyan-500"
            />
          )}
          <span className="text-xs text-[var(--text-muted)]">
            {isGrouped
              ? t('notifications.inbox.countLabel', '{{count}} notifications', { count: groups.length })
              : t('notifications.inbox.countLabel', '{{count}} notifications', { count: rows.length })}
          </span>
          {!archived && (
            <div
              className="ml-auto flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.02] p-0.5"
              role="group"
              aria-label={t('notifications.view.label', 'View')}
            >
              <button
                type="button"
                onClick={() => setView('grouped')}
                aria-pressed={view === 'grouped'}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs',
                  view === 'grouped'
                    ? 'bg-cyan-400/15 text-cyan-200'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
                )}
                data-testid="view-toggle-grouped"
              >
                <Layers className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                  {t('notifications.view.grouped', 'Grouped')}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setView('flat')}
                aria-pressed={view === 'flat'}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs',
                  view === 'flat'
                    ? 'bg-cyan-400/15 text-cyan-200'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
                )}
                data-testid="view-toggle-flat"
              >
                <List className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                  {t('notifications.view.flat', 'Flat')}
                </span>
              </button>
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

        {/* Loading / error / empty states — branched so the right cache
            and error message surface for whichever view is active. */}
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

        {/* Empty state — flat-mode uses the day-grouped buckets; grouped
            mode uses the bare groups array. Both surface the same i18n
            empty copy so the "no rules configured" CTA reads the same. */}
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
              to: '/alert-studio',
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
              to: '/alert-studio',
            }}
          />
        )}

        {/* Body render — flat mode keeps the day-bucket grouping and bulk
            selection affordances; grouped mode renders one
            NotificationGroupRow per thread without day buckets (threads
            already aggregate across time). */}
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
                  onActivate={handleRowActivate}
                  onArchive={(id) => archiveMut.mutate([id])}
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

export default function NotificationsPage() {
  const { t } = useTranslation();
  usePageTitle(t('notifications.title', 'Notifications'));

  // Tab is in the URL so a deep link like /notifications?tab=channels works.
  // push: true on tab changes — primary navigation should add a history entry.
  const [tab, setTab] = useUrlEnum<InboxTab>('tab', INBOX_TABS, 'inbox');
  const { data: vehicles = [] } = useVehicles();
  const { data: rules = [] } = useAlertRules();

  return (
    <PageContainer
      title={t('notifications.title', 'Notifications')}
      subtitle={t('notifications.subtitle', 'Inbox of fired alerts plus delivery channels.')}
      copyLink
    >
      <TabNav
        active={tab}
        onChange={(k) => setTab(k as InboxTab, { push: true })}
        tabs={[
          { key: 'inbox', label: t('notifications.tab.inbox', 'Inbox'), icon: <Bell className="h-4 w-4" /> },
          { key: 'archived', label: t('notifications.tab.archived', 'Archived'), icon: <Archive className="h-4 w-4" /> },
          { key: 'channels', label: t('notifications.tab.channels', 'Channels'), icon: <Bell className="h-4 w-4" /> },
        ]}
      />

      {tab === 'inbox' && (
        <InboxBody key="inbox" archived={false} vehicles={vehicles} rules={rules} />
      )}
      {tab === 'archived' && (
        <InboxBody key="archived" archived={true} vehicles={vehicles} rules={rules} />
      )}
      {tab === 'channels' && <NotificationChannelsView />}
    </PageContainer>
  );
}
