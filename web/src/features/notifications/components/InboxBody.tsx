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
 *   - Selectable flat table AND threaded grouped list
 *
 * Used by InboxPage (`archived=false`) and ArchivedPage (`archived=true`).
 * Was previously an inner component of the now-removed NotificationsPage.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useCallback,
  useState,
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
  ConfirmDialog,
  GlassPanel,
  Modal,
  Pagination,
  Text,
  useContextMenu,
  type ContextMenuItem,
} from '@/components/ui';
import { BulkActionsToolbar, type BulkAction } from '@/components/data-display';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { useToast } from '@/components/feedback/Toast';
import { ListExportMenu, type ExportScope } from '@/components/forms';
import { FadeIn } from '@/components/motion/FadeIn';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { useConfirm } from '@/hooks/useConfirm';
import { useAnnouncer } from '@/hooks/useAnnouncer';
import { useRangeState } from '@/hooks/useRangeState';
import { useProductPreferences } from '@/hooks/useProductPreferences';
import { useUrlEnum, useUrlString, useUrlArray, useUrlBatch } from '@/hooks/useUrlState';
import {
  useNotificationLogs,
  useNotificationLogCount,
  useNotificationGroups,
  useArchiveNotifications,
  useUnarchiveNotifications,
  useMarkNotificationsRead,
  useMarkNotificationsUnread,
  useBulkMarkRead,
  useDeleteNotifications,
  useAlertDetail,
  useAcknowledgeAlert,
  useReopenAlert,
  type NotificationFilters,
} from '@/api/hooks/useNotifications';
import type { NotificationLog, AlertRule, Vehicle, Alert } from '@/api/types';
import { getAlertDrillthroughHref } from '@/lib/alertDrillthrough';
import { NotificationFilterBar } from './NotificationFilterBar';
import { AIInboxAutoCategorization } from '@/components/ai/AIInboxAutoCategorization';
import { NotificationGroupRow } from './NotificationGroupRow';
import { AlertDetailDrawer } from './AlertDetailDrawer';
import { PullToRefresh } from '@/components/mobile';
import { exportAsCSV, exportAsJSON } from '@/lib/export';
import { NotificationInboxTable } from './NotificationInboxTable';

const SEVERITY_VALUES = ['info', 'warn', 'critical'] as const;
type SeverityValue = (typeof SEVERITY_VALUES)[number];

const READ_VALUES = ['all', 'read', 'unread'] as const;
type ReadValue = (typeof READ_VALUES)[number];

// Show each notification on arrival; grouped threads remain an opt-in view.
const VIEW_VALUES = ['grouped', 'flat'] as const;
type ViewValue = (typeof VIEW_VALUES)[number];
const INBOX_PAGE_SIZE = 50;

function notificationExportRow(log: NotificationLog): Record<string, unknown> {
  return {
    id: log.id,
    created_at: log.created_at,
    sent_at: log.sent_at,
    scheduled_at: log.scheduled_at ?? '',
    title: log.title,
    message: log.message,
    severity: log.severity ?? '',
    status: log.status,
    read_at: log.read_at ?? '',
    archived_at: log.archived_at ?? '',
    channel_id: log.channel_id,
    alert_id: log.alert_id,
    latency_ms: log.latency_ms ?? null,
    error: log.error,
  };
}

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
  const [source] = useUrlEnum<'all' | 'rule'>('source', ['all', 'rule'], 'all');
  const [search] = useUrlString('q', '');
  const [readState] = useUrlEnum<ReadValue>('read', READ_VALUES, 'all');
  const { preferences } = useProductPreferences();
  const {
    startInstant,
    endInstantExclusive,
  } = useRangeState({
    defaultPresetId: preferences.defaultAnalysisRange,
  });
  // View mode is URL-backed too so a deep link can
  // express "Inbox, grouped" vs "Inbox, flat" independent of filter state.
  const [view, setView] = useUrlEnum<ViewValue>('view', VIEW_VALUES, 'flat');
  const [page, setPage] = useState(1);
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
    source: source === 'rule' ? 'rule' : undefined,
    q: search || undefined,
    from: startInstant,
    to_exclusive: endInstantExclusive,
    read: readState === 'all' ? undefined : readState === 'read',
    limit: INBOX_PAGE_SIZE,
    offset: (page - 1) * INBOX_PAGE_SIZE,
  }), [archived, severity, vehicleIds, ruleIds, source, search, startInstant, endInstantExclusive, readState, page]);

  const severityKey = severityRaw.join(',');
  const vehicleKey = vehicleIdsRaw.join(',');
  const ruleKey = ruleIdsRaw.join(',');
  useEffect(() => { setPage(1); }, [archived, severityKey, vehicleKey, ruleKey, source, search, startInstant, endInstantExclusive, readState, view]);

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
      source: next.source ?? null,
      q: next.q ?? null,
      read: readValue,
    };
    setFiltersBatch(urlUpdates);
  }, [setFiltersBatch]);

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
  const { data: countData, error: countError } = useNotificationLogCount(filters, { grouped: isGrouped });
  const rows = useMemo<NotificationLog[]>(() => rawRows ?? [], [rawRows]);
  const [openedLog, setOpenedLog] = useState<NotificationLog | null>(null);
  const alertDetail = useAlertDetail(openedLog?.alert_id != null ? openedLog.id : null);
  const acknowledgeAlert = useAcknowledgeAlert();
  const reopenAlert = useReopenAlert();

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
  const groupedNotificationCount = useMemo(
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
  const { confirm: confirmDelete, dialogProps: deleteDialogProps } = useConfirm();
  const toast = useToast();
  const { announce } = useAnnouncer();

  const handleSingleDelete = useCallback(
    async (log: NotificationLog) => {
      const ok = await confirmDelete({
        title: t('notifications.inbox.single.deleteConfirmTitle', 'Delete this notification?'),
        message: t(
          'notifications.inbox.single.deleteConfirmBody',
          '“{{title}}” will be permanently removed. Archive is usually the safer choice.',
          { title: log.title },
        ),
        variant: 'danger',
        confirmLabel: t('common.delete', 'Delete'),
      });
      if (ok) deleteMut.mutate([log.id]);
    },
    [confirmDelete, deleteMut, t],
  );

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
  const setTableSelection = useCallback(
    (ids: number[]) => {
      const next = new Set(ids);
      for (const id of selected) {
        if (!next.has(id)) toggleSelected(id, false);
      }
      for (const id of ids) {
        if (!selected.has(id)) toggleSelected(id, true);
      }
    },
    [selected, toggleSelected],
  );
  const visibleExportRows = useMemo(
    () =>
      isGrouped
        ? groups.map((group) => ({
            ...notificationExportRow(group.latest),
            thread_count: group.count,
            unread_count: group.unread_count,
            vehicle_ids: group.vehicle_ids.join(','),
          }))
        : rows.map((row) => ({
            ...notificationExportRow(row),
            thread_count: 1,
            unread_count: row.read_at ? 0 : 1,
            vehicle_ids: '',
          })),
    [groups, isGrouped, rows],
  );
  const selectedExportRows = useMemo(
    () =>
      isGrouped
        ? []
        : rows
            .filter((row) => selected.has(row.id))
            .map((row) => notificationExportRow(row)),
    [isGrouped, rows, selected],
  );
  const exportRows = useCallback(
    (scope: ExportScope) =>
      scope === 'selected' && selectedExportRows.length > 0
        ? selectedExportRows
        : visibleExportRows,
    [selectedExportRows, visibleExportRows],
  );
  const exportFilename = `${archived ? 'teslasync-notifications-archive' : 'teslasync-notifications'}-${new Date().toISOString().slice(0, 10)}`;
  const handleExportCsv = useCallback(
    (scope: ExportScope) => {
      exportAsCSV(exportRows(scope), `${exportFilename}.csv`);
    },
    [exportFilename, exportRows],
  );
  const handleExportJson = useCallback(
    (scope: ExportScope) => {
      exportAsJSON(exportRows(scope), `${exportFilename}.json`);
    },
    [exportFilename, exportRows],
  );
  // Drop selections when filter changes — selection should never carry over
  // across a different result set.
  useEffect(() => { clearSelection(); }, [filters, clearSelection]);

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
    setOpenedLog(log);
    if (!log.read_at && readPref(PREF_MARK_ON_CLICK)) markReadMut.mutate([log.id]);
  };

  const openedRule = openedLog?.alert_id != null ? ruleMap[openedLog.alert_id] : undefined;
  const openedVehicle = openedRule?.vehicle_id != null ? vehicleMap[openedRule.vehicle_id] : undefined;
  const openedAlert: Alert | null = openedLog?.alert_id != null ? {
    id: openedLog.id,
    vehicle_id: openedVehicle?.id ?? openedRule?.vehicle_id ?? 0,
    type: openedRule?.name ?? openedLog.event_type ?? openedLog.title,
    severity: (openedRule?.severity ?? openedLog.severity ?? 'info') as Alert['severity'],
    title: openedLog.title,
    message: openedLog.message,
    is_read: !!openedLog.read_at,
    created_at: openedLog.created_at,
    rule_id: openedRule?.id,
    rule_signal: openedRule?.signal_name,
    acknowledged_at: alertDetail.data?.acknowledged_at ?? null,
  } : null;

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
        onClick: () => void handleSingleDelete(log),
      });
      return items;
    },
    [ruleMap, vehicleMap, t, archiveMut, unarchiveMut, markReadMut, markUnreadMut, handleSingleDelete, navigate],
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
    <>
    <AlertDetailDrawer
      alert={openedAlert}
      detail={alertDetail.data}
      isLoading={alertDetail.isLoading}
      error={alertDetail.error}
      vehicleName={openedVehicle?.display_name}
      onClose={() => setOpenedLog(null)}
      onAcknowledge={id => acknowledgeAlert.mutate({ id })}
      onReopen={id => reopenAlert.mutate(id)}
      onRetry={() => { void alertDetail.refetch(); }}
    />
    <Modal
      open={openedLog !== null && openedLog.alert_id == null}
      onClose={() => setOpenedLog(null)}
      title={openedLog?.title || t('notifications.inbox.detail.title', 'Notification details')}
    >
      <div className="space-y-3">
        <Text variant="body" className="whitespace-pre-wrap break-words">{openedLog?.message ?? ''}</Text>
        <Text variant="caption">{openedLog?.event_type ?? t('notifications.inbox.legacyDelivery', 'Legacy channel delivery (original source not recorded)')}</Text>
        <Text variant="caption">{openedLog?.created_at ? new Date(openedLog.created_at).toLocaleString() : ''}</Text>
      </div>
    </Modal>
    <PullToRefresh onRefresh={async () => { await (isGrouped ? groupsRefetch() : refetch()); }}>
    <div className="space-y-4">
      <FadeIn>
        <div data-tour="alerts-filters">
        <NotificationFilterBar
          filters={filters}
          onChange={handleFiltersChange}
          vehicles={vehicles}
          rules={rules}
        />
        </div>
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

      <GlassPanel className="p-3 sm:p-4" data-tour="alerts-list">
        <div className="mb-2 flex items-center gap-3 px-1 pb-2 border-b border-white/[0.04]">
          <span
            className="text-xs text-[var(--text-muted)]"
            data-testid="inbox-result-count"
          >
            {isGrouped ? (
              <>
                {t('notifications.inbox.threadCountLabel', '{{count}} threads', {
                  count: countData?.total ?? groups.length,
                })}
                <span aria-hidden="true"> · </span>
                {t('notifications.inbox.notificationCountLabel', '{{count}} notifications', {
                  count: groupedNotificationCount,
                })}
              </>
            ) : (
              t('notifications.inbox.countLabel', '{{count}} notifications', { count: countData?.total ?? rows.length })
            )}
          </span>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <ListExportMenu
              onExportCsv={handleExportCsv}
              onExportJson={handleExportJson}
              selectedCount={isGrouped ? 0 : selected.size}
              visibleCount={visibleExportRows.length}
              disabled={
                visibleExportRows.length === 0 ||
                (isGrouped ? groupsLoading : isLoading)
              }
              testId="notification-export"
            />
            {!archived && (
              <div
                className="flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.02] p-0.5"
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

        {!isGrouped && !isLoading && !error && rows.length === 0 && (
          <EmptyState
            icon={<Bell className="h-8 w-8" />}
            title={archived
              ? t('notifications.inbox.empty.archivedTitle', 'No archived notifications')
              : t('notifications.inbox.empty.title', 'No notifications')}
            message={archived
              ? t('notifications.inbox.empty.archivedMessage', 'Archived notifications will appear here.')
              : source === 'rule'
                ? t('notifications.inbox.empty.ruleTriggers', 'No rule-triggered notifications match these filters. Check the date range or configure a rule in Alert Studio.')
                : t('notifications.inbox.empty.message', 'System events, alerts, automation, and scheduled notifications appear here when triggered.')}
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
            message={t('notifications.group.emptyMessage', 'Related notifications are grouped here when they occur repeatedly.')}
            actionTo={{
              label: t('notifications.inbox.empty.cta', 'Configure alert rules'),
              to: '/notifications/studio',
            }}
          />
        )}

        {!isGrouped && !isLoading && !error && rows.length > 0 && (
          <NotificationInboxTable
            rows={rows}
            selectedIds={Array.from(selected)}
            onSelectionChange={setTableSelection}
            onActivate={handleRowActivate}
            onContextMenu={buildRowContextMenu}
            ruleMap={ruleMap}
            vehicleMap={vehicleMap}
            archived={archived}
          />
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
      {countError && <Text variant="bodySm">{t('notifications.inbox.countError', 'Could not load the notification count: {{error}}', { error: String(countError) })}</Text>}
      {countData && countData.total > 0 && (
        <Pagination page={page} pageSize={INBOX_PAGE_SIZE} total={countData.total} onPageChange={setPage} />
      )}
    </div>
    </PullToRefresh>
      {deleteDialogProps && <ConfirmDialog {...deleteDialogProps} />}
    </>
  );
}

export default InboxBody;
