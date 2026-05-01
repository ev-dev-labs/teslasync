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

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, ArchiveRestore, Bell, MailOpen, Trash2 } from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Button, TabNav, ConfirmDialog, DataTableBulkBar } from '@/components/ui';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FadeIn } from '@/components/motion/FadeIn';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useConfirm } from '@/hooks/useConfirm';
import { useVehicles } from '@/api/hooks/useVehicles';
import {
  useAlertRules,
  useNotificationLogs,
  useArchiveNotifications,
  useUnarchiveNotifications,
  useMarkNotificationsRead,
  useMarkNotificationsUnread,
  useDeleteNotifications,
  type NotificationFilters,
} from '@/api/hooks/useNotifications';
import type { NotificationLog, AlertRule, Vehicle } from '@/api/types';
import { NotificationFilterBar } from '../components/NotificationFilterBar';
import { NotificationRow } from '../components/NotificationRow';
import { NotificationChannelsView } from '../components/NotificationChannelsView';

type InboxTab = 'inbox' | 'archived' | 'channels';

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
  const [filters, setFilters] = useState<NotificationFilters>(() => ({ archived }));

  // Sync the archived flag when the parent flips tabs.
  useEffect(() => {
    setFilters(f => ({ ...f, archived }));
  }, [archived]);

  const { data: rawRows, isLoading, error } = useNotificationLogs(filters);
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
  const archiveMut = useArchiveNotifications();
  const unarchiveMut = useUnarchiveNotifications();
  const deleteMut = useDeleteNotifications();

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

  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Drop selections when filter changes — selection should never carry over
  // across a different result set.
  useEffect(() => { setSelected(new Set()); }, [filters]);

  const toggleSelected = (id: number, on: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());
  const selectAllVisible = () => setSelected(new Set(rows.map(r => r.id)));
  const allVisibleSelected = rows.length > 0 && rows.every(r => selected.has(r.id));

  const grouped = useMemo(() => groupByDay(rows), [rows]);

  const { confirm, dialogProps } = useConfirm();

  const handleBulkArchive = () => {
    archiveMut.mutate(Array.from(selected), { onSuccess: clearSelection });
  };
  const handleBulkUnarchive = () => {
    unarchiveMut.mutate(Array.from(selected), { onSuccess: clearSelection });
  };
  const handleBulkMarkRead = () => {
    markReadMut.mutate(Array.from(selected), { onSuccess: clearSelection });
  };
  const handleBulkDelete = async () => {
    const ok = await confirm({
      title: t('notifications.inbox.bulk.deleteConfirmTitle', 'Delete notifications?'),
      message: t('notifications.inbox.bulk.deleteConfirmBody', 'These notifications will be permanently removed. Archive is usually the safer choice.'),
      confirmLabel: t('common.delete', 'Delete'),
      variant: 'danger',
    });
    if (!ok) return;
    deleteMut.mutate(Array.from(selected), { onSuccess: clearSelection });
  };

  const handleRowActivate = (log: NotificationLog) => {
    if (log.read_at) return;
    if (!readPref(PREF_MARK_ON_CLICK)) return;
    markReadMut.mutate([log.id]);
  };

  return (
    <div className="space-y-4">
      <FadeIn>
        <NotificationFilterBar
          filters={filters}
          onChange={setFilters}
          vehicles={vehicles}
          rules={rules}
        />
      </FadeIn>

      <DataTableBulkBar count={selected.size} onClear={clearSelection}>
        {!archived && (
          <Button
            variant="ghost"
            size="sm"
            icon={<MailOpen className="h-3.5 w-3.5" />}
            onClick={handleBulkMarkRead}
          >
            {t('notifications.inbox.bulk.markRead', 'Mark read')}
          </Button>
        )}
        {!archived && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Archive className="h-3.5 w-3.5" />}
            onClick={handleBulkArchive}
          >
            {t('notifications.inbox.bulk.archive', 'Archive')}
          </Button>
        )}
        {archived && (
          <Button
            variant="ghost"
            size="sm"
            icon={<ArchiveRestore className="h-3.5 w-3.5" />}
            onClick={handleBulkUnarchive}
          >
            {t('notifications.inbox.bulk.restore', 'Restore')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 className="h-3.5 w-3.5" />}
          onClick={handleBulkDelete}
        >
          {t('notifications.inbox.bulk.delete', 'Delete')}
        </Button>
      </DataTableBulkBar>

      <GlassPanel className="p-3 sm:p-4">
        {/* Select-all row */}
        <div className="mb-2 flex items-center gap-3 px-1 pb-2 border-b border-white/[0.04]">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={e => (e.target.checked ? selectAllVisible() : clearSelection())}
            aria-label={t('notifications.inbox.selectAll', 'Select all visible')}
            className="h-4 w-4 cursor-pointer rounded border-white/20 bg-white/[0.04] text-cyan-500 focus:ring-2 focus:ring-cyan-500"
          />
          <span className="text-xs text-[var(--text-muted)]">
            {t('notifications.inbox.countLabel', '{{count}} notifications', { count: rows.length })}
          </span>
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
                    <NotificationRow
                      key={log.id}
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
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassPanel>

      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  );
}

export default function NotificationsPage() {
  const { t } = useTranslation();
  usePageTitle(t('notifications.title', 'Notifications'));

  const [tab, setTab] = useState<InboxTab>('inbox');
  const { data: vehicles = [] } = useVehicles();
  const { data: rules = [] } = useAlertRules();

  return (
    <PageContainer
      title={t('notifications.title', 'Notifications')}
      subtitle={t('notifications.subtitle', 'Inbox of fired alerts plus delivery channels.')}
    >
      <TabNav
        active={tab}
        onChange={(k) => setTab(k as InboxTab)}
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
