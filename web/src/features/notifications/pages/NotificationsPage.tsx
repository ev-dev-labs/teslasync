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
 */

import { useEffect, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, ArchiveRestore, Bell, MailOpen, Trash2, CheckCheck } from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { Button, GlassPanel, TabNav } from '@/components/ui';
import { BulkActionsToolbar, type BulkAction } from '@/components/data-display';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { useToast } from '@/components/feedback/Toast';
import { FadeIn } from '@/components/motion/FadeIn';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { useUrlEnum, useUrlString, useUrlArray, useUrlBatch } from '@/hooks/useUrlState';
import { useVehicles } from '@/api/hooks/useVehicles';
import {
  useAlertRules,
  useNotificationLogs,
  useArchiveNotifications,
  useUnarchiveNotifications,
  useMarkNotificationsRead,
  useMarkNotificationsUnread,
  useBulkMarkRead,
  useDeleteNotifications,
  type NotificationFilters,
} from '@/api/hooks/useNotifications';
import type { NotificationLog, AlertRule, Vehicle } from '@/api/types';
import { NotificationFilterBar } from '../components/NotificationFilterBar';
import { NotificationRow } from '../components/NotificationRow';
import { NotificationChannelsView } from '../components/NotificationChannelsView';
import { PullToRefresh, SwipeRow } from '@/components/mobile';

type InboxTab = 'inbox' | 'archived' | 'channels';

const INBOX_TABS = ['inbox', 'archived', 'channels'] as const satisfies readonly InboxTab[];

const SEVERITY_VALUES = ['info', 'warn', 'critical'] as const;
type SeverityValue = (typeof SEVERITY_VALUES)[number];

const READ_VALUES = ['all', 'read', 'unread'] as const;
type ReadValue = (typeof READ_VALUES)[number];

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
  const setFiltersBatch = useUrlBatch();

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

  const { data: rawRows, isLoading, error, refetch } = useNotificationLogs(filters);
  const rows = useMemo<NotificationLog[]>(() => rawRows ?? [], [rawRows]);

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

  // Auto-mark-read on inbox open (only on the Inbox tab, not Archived).
  const autoMarkedRef = useRef(false);
  useEffect(() => {
    if (archived) return;
    if (autoMarkedRef.current) return;
    if (isLoading) return;
    if (!readPref(PREF_MARK_ON_OPEN)) return;
    const unread = rows.filter(r => !r.read_at).map(r => r.id);
    if (unread.length === 0) return;
    autoMarkedRef.current = true;
    markReadMut.mutate(unread);
  }, [archived, isLoading, rows, markReadMut]);

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
  }, [archiveMut]);
  const handleBulkUnarchive = useCallback(async (ids: Array<string | number>) => {
    await unarchiveMut.mutateAsync(ids.map(Number));
    clearSelection();
  }, [unarchiveMut]);
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

  return (
    <PullToRefresh onRefresh={async () => { await refetch(); }}>
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
            inbox tab when there's something to mark. */}
        <div className="mb-2 flex items-center gap-3 px-1 pb-2 border-b border-white/[0.04]">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={e => (e.target.checked ? selectAllVisible() : clearSelection())}
            aria-label={t('notifications.inbox.selectAll', 'Select all visible')}
            className="h-4 w-4 cursor-pointer rounded border-[var(--border-strong)] bg-white/[0.04] text-cyan-500 focus:ring-2 focus:ring-cyan-500"
          />
          <span className="text-xs text-[var(--text-muted)]">
            {t('notifications.inbox.countLabel', '{{count}} notifications', { count: rows.length })}
          </span>
          {!archived && unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkAllRead}
              disabled={bulkMarkReadMut.isPending}
              icon={<CheckCheck className="h-3.5 w-3.5" />}
              className="ml-auto text-xs"
              aria-label={t('notifications.markAllRead.action', 'Mark all read')}
            >
              {t('notifications.markAllRead.action', 'Mark all read')}
            </Button>
          )}
        </div>

        {isLoading && (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-14" />)}
          </div>
        )}

        {!isLoading && error && (
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

        {!isLoading && !error && grouped.length === 0 && (
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

        {!isLoading && !error && grouped.length > 0 && (
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
                    </SwipeRow>
                  ))}
                </div>
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
