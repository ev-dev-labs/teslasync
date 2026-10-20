/**
 * Renders one server-aggregated notification thread.
 *
 * Represents a group of repeated
 * deliveries for the same alert rule + severity). Composes the existing
 * `NotificationRow` so the latest member always renders identically to a
 * row in the flat view; the grouping affordances live OUTSIDE that row:
 *
 *   - "+N similar" chip beside the latest row
 *   - expand/collapse caret that inlines the rest of the thread
 *   - "Mark group read" action that hits the backend's group_key path
 *
 * Singleton groups (group_key === null) render as a plain row with the
 * grouping chrome hidden — UX is identical to flat view, so the user
 * never sees a noisy +0 chip on rules that only fired once.
 *
 * Member fetching is lazy (`useGroupMembers` is gated on `expanded`) so
 * the inbox doesn't stampede the API with N expand-fetches up front.
 */
import { useState, useCallback, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, MailOpen, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, Text, Caption } from '@/components/ui';
import { StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { typography } from '@/lib/tokens';
import { useGroupMembers, useBulkMarkRead, type NotificationFilters } from '@/api/hooks/useNotifications';
import { useToast } from '@/components/feedback/Toast';
import type { NotificationLog, NotificationLogGroup, AlertRule, Vehicle } from '@/api/types';
import { NotificationRow } from './NotificationRow';

export interface NotificationGroupRowProps {
  group: NotificationLogGroup;
  /** Lookup map for resolving alert_id → rule (for severity coloring + name). */
  ruleMap: Record<number, AlertRule>;
  /** Lookup map for resolving rule.vehicle_id → vehicle (for tz + display name). */
  vehicleMap: Record<number, Vehicle>;
  /** Filters from the parent inbox so members fetch with the same window. */
  filters: NotificationFilters;
  /**
   * Per-row selection set (member ids). The latest row and any expanded
   * member rows look themselves up in this set to render their checkbox
   * state, so a click on the visible checkbox cleanly maps to a single
   * id even though the group itself does not. Optional for callers that
   * still want a read-only group display.
   */
  selectedIds?: Set<number>;
  /** Per-row selection toggle fired by the checkbox in any member row. */
  onSelectionChange?: (id: number, selected: boolean) => void;
  /** Per-row activate (used to mark single rows read on click). */
  onActivate?: (log: NotificationLog) => void;
  /** Per-row archive/restore. */
  onArchive?: (id: number) => void;
  onUnarchive?: (id: number) => void;
  /** Per-row mark read/unread (only used inside the expanded member list). */
  onMarkRead?: (id: number) => void;
  onMarkUnread?: (id: number) => void;
  /** Whether the parent is in archived mode (alters the per-row swipe action). */
  archived: boolean;
}

export function NotificationGroupRow({
  group,
  ruleMap,
  vehicleMap,
  filters,
  selectedIds,
  onSelectionChange,
  onActivate,
  onArchive,
  onUnarchive,
  onMarkRead,
  onMarkUnread,
  archived,
}: NotificationGroupRowProps) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const toast = useToast();
  const bulkMarkRead = useBulkMarkRead();
  const [expanded, setExpanded] = useState(false);
  const regionId = useId();

  const isSingleton = group.group_key == null;
  const extraCount = Math.max(0, group.count - 1);

  // Fetch members lazily on expand. Reuse parent filters so the expanded
  // list mirrors the same window — anything the group's `count` did NOT
  // include won't surface here either.
  const membersQuery = useGroupMembers(group.group_key ?? null, filters, { enabled: expanded && !isSingleton });
  const membersState = useDataState(membersQuery, { provenance: 'historical' });
  const members = membersQuery.data ?? [];
  const membersLabel = t('notifications.group.membersLabel', 'Thread members');

  // Latest member is what the parent renders by default; the expanded list
  // omits it to avoid duplicating the same row above and below the chevron.
  const latest = group.latest;
  const latestRule = latest.alert_id != null ? ruleMap[latest.alert_id] : undefined;
  const latestVehicleId = latestRule?.vehicle_id ?? undefined;
  const latestVehicle = latestVehicleId != null ? vehicleMap[latestVehicleId] : undefined;

  const otherMembers = members.filter((m) => m.id !== latest.id);

  const handleMarkGroupRead = useCallback(async () => {
    const gk = group.group_key;
    if (!gk) return;
    try {
      const res = await bulkMarkRead.mutateAsync({ group_key: gk });
      toast.toast({
        type: 'success',
        title: t('notifications.group.markReadSuccessFormatted', 'Marked {{formattedCount}} thread members as read', {
          count: res.updated, formattedCount: fmtInt(res.updated),
        }),
        duration: 4000,
      });
    } catch (e) {
      toast.error(
        t('notifications.group.markReadError', 'Could not mark group as read'),
        e instanceof Error ? e.message : undefined,
      );
    }
  }, [bulkMarkRead, group.group_key, toast, t, fmtInt]);

  // Selection is per-member (a group has many ids; the visible row IS one
  // member). When the parent doesn't wire a handler we fall back to a
  // no-op so the checkbox simply renders unchecked and inert — but in the
  // primary inbox flow `selectedIds` + `onSelectionChange` ARE wired so a
  // click on the visible checkbox toggles that latest member, exactly the
  // way it does in the flat view. The "Mark group read" affordance below
  // is the only group-scoped action we offer.
  const noopSelection = useCallback((_id: number, _on: boolean) => {
    // intentional fallback when the parent doesn't wire selection
  }, []);
  const rowSelectionHandler = onSelectionChange ?? noopSelection;
  const isMemberSelected = useCallback(
    (id: number) => (selectedIds ? selectedIds.has(id) : false),
    [selectedIds],
  );

  const expandLabel = expanded
    ? t('notifications.group.collapse', 'Hide similar')
    : t('notifications.group.expandFormatted', 'Show {{formattedCount}} similar', { count: extraCount, formattedCount: fmtInt(extraCount) });

  return (
    <div className="rounded-lg" data-testid="notification-group-row">
      <div className="flex items-stretch gap-2">
        <div className="flex-1 min-w-0">
          <NotificationRow
            log={latest}
            rule={latestRule}
            vehicle={latestVehicle}
            selected={isMemberSelected(latest.id)}
            onSelectionChange={rowSelectionHandler}
            onActivate={onActivate}
            onArchive={onArchive}
            onUnarchive={onUnarchive}
            onMarkRead={onMarkRead}
            onMarkUnread={onMarkUnread}
          />
          {!isSingleton && (extraCount > 0 || group.unread_count > 1) && (
            <div className="mt-1 flex flex-wrap items-center gap-2 px-3 pb-1">
              {extraCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpanded((v) => !v)}
                  aria-expanded={expanded}
                  aria-controls={regionId}
                  aria-label={expandLabel}
                  className={cn(
                    'h-auto min-h-11 md:min-h-9 gap-1 rounded-full border border-[var(--border-default)] bg-[var(--surface-2)] px-2 py-0.5',
                    typography.role.caption,
                  )}
                  data-testid="group-expand-toggle"
                >
                  {expanded ? (
                    <ChevronDown className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="h-3 w-3" aria-hidden="true" />
                  )}
                  <span>
                    {t('notifications.group.similarFormatted', '+{{formattedCount}} similar', {
                      count: extraCount,
                      formattedCount: fmtInt(extraCount),
                    })}
                  </span>
                </Button>
              )}
              {group.unread_count > 0 && (
                <Caption as="span"
                  className="inline-flex items-center rounded-full bg-[var(--surface-2)] px-2 py-0.5 tabular-nums"
                  data-testid="group-unread-count"
                >
                  {t('notifications.group.unreadCount', '{{formattedCount}} unread thread members', {
                    count: group.unread_count, formattedCount: fmtInt(group.unread_count),
                  })}
                </Caption>
              )}
              {group.vehicle_ids.length > 0 && (
                <Caption as="span" data-testid="group-vehicle-count">
                  {t('notifications.group.vehicleAffectedFormatted', '{{formattedCount}} vehicles affected', {
                    count: group.vehicle_ids.length,
                    formattedCount: fmtInt(group.vehicle_ids.length),
                  })}
                </Caption>
              )}
              {group.unread_count > 0 && !archived && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<MailOpen className="h-3.5 w-3.5" aria-hidden="true" />}
                  onClick={handleMarkGroupRead}
                  disabled={bulkMarkRead.isPending}
                  className="ms-auto min-h-11 md:min-h-9"
                  aria-label={t('notifications.group.markRead', 'Mark group read')}
                  data-testid="group-mark-read"
                >
                  {t('notifications.group.markRead', 'Mark group read')}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {expanded && !isSingleton && (
        <div
          id={regionId}
          role="region"
          aria-label={t('notifications.group.collapse', 'Hide similar')}
          className="ms-4 mt-1 space-y-1 border-s-2 border-[var(--border-subtle)] ps-3"
          data-testid="group-members-region"
        >
          <StaleRefreshWarning state={membersState} label={membersLabel} />
          {membersState.status === 'initial' && (
            <div
              className="flex items-center gap-2 px-2 py-2"
              role="status"
              aria-live="polite"
            >
              {membersQuery.isFetching && <Loader2 className="h-3 w-3" aria-hidden="true" />}
              <Text variant="bodySm">
                {membersState.isRefreshBlocked
                  ? t('fleetOps.brief.refreshBlocked', 'Refresh paused')
                  : membersQuery.isFetching
                    ? t('notifications.group.loadingMembers', 'Loading thread members…')
                    : t('common.unknown', 'Unknown')}
              </Text>
            </div>
          )}
          {membersState.fatalError && (
            <div
              className="space-y-2 px-2 py-2"
              role="alert"
              data-testid="group-members-error"
            >
              <Text variant="bodySm">{t('notifications.group.membersError', 'Could not load thread members')}</Text>
              <Button type="button" variant="secondary" size="sm" className="min-h-11 md:min-h-9"
                onClick={() => { void membersQuery.refetch(); }}>
                {t('error.retry', 'Retry')}
              </Button>
            </div>
          )}
          {membersState.hasData && !membersState.refreshError && otherMembers.length === 0 && (
            <div className="px-2 py-2">
              <Text variant="bodySm">
                {t('notifications.group.noMembers', 'No thread members found')}
              </Text>
            </div>
          )}
          {otherMembers.map((m) => {
            const rule = m.alert_id != null ? ruleMap[m.alert_id] : undefined;
            const vehicle = rule?.vehicle_id != null ? vehicleMap[rule.vehicle_id] : undefined;
            return (
              <NotificationRow
                key={m.id}
                log={m}
                rule={rule}
                vehicle={vehicle}
                selected={isMemberSelected(m.id)}
                onSelectionChange={rowSelectionHandler}
                onActivate={onActivate}
                onArchive={onArchive}
                onUnarchive={onUnarchive}
                onMarkRead={!m.read_at ? onMarkRead : undefined}
                onMarkUnread={m.read_at ? onMarkUnread : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
