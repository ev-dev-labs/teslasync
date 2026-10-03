/**
 * InboxSummary — KPI band for the active Notifications inbox.
 *
 * Derives a compact, responsive context strip from the latest page of active
 * notifications (`useNotificationLogs({ archived: false })`, passed in from the page
 * so it can dedupe with the InboxBody's own fetch). Leads with the unread
 * count — the inbox's primary triage metric — then breaks the backlog down by
 * severity and surfaces how recently the newest notification arrived.
 *
 * Every state — loading, error, empty — is handled here so the band stays
 * self-sufficient and the panel remains visible regardless of data
 * availability. ArchivedPage reuses this strip with archived timestamps and
 * labels; it does not turn a bounded sample into a period-wide aggregate.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import { Archive, Inbox, MailWarning, AlertOctagon, AlertTriangle, Info, Clock } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { EmptyState, QueryError, StatGridSkeleton, StaleRefreshWarning } from '@/components/feedback';
import type { NotificationLog } from '@/api/types';
import { formatRelativeTime, formatDateTime } from '@/lib/dateFormat';

import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export interface InboxSummaryProps {
  /** The active (non-archived) notifications query (TanStack result) from the page. */
  query: UseQueryResult<NotificationLog[]>;
  archived?: boolean;
}

interface InboxStats {
  total: number;
  unread: number;
  critical: number;
  warn: number;
  info: number;
  lastTs: number;
}

/** Compact backlog context; complete period aggregates remain in the report. */
export function InboxSummary({ query, archived = false }: InboxSummaryProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const state = useDataState(query);
  const rows = query.data ?? [];

  const stats = useMemo<InboxStats>(() => {
    let unread = 0;
    let critical = 0;
    let warn = 0;
    let info = 0;
    let lastTs = 0;
    for (const row of rows) {
      const severity = archived ? (row.severity ?? '').trim().toLowerCase() : row.severity ?? '';
      if (severity === 'critical') critical += 1;
      else if (severity === 'warn') warn += 1;
      else if (severity === 'info') info += 1;
      if (!row.read_at) unread += 1;
      const timestamp = archived ? row.archived_at : row.created_at;
      const ts = timestamp ? new Date(timestamp).getTime() : 0;
      if (Number.isFinite(ts) && ts > lastTs) lastTs = ts;
    }
    return { total: rows.length, unread, critical, warn, info, lastTs };
  }, [rows, archived]);

  const gridClass = 'grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 xl:grid-cols-6';
  const sectionLabel = archived ? t('notifications.archived.summary.label', 'Archived summary') : t('notifications.inbox.summary.label', 'Inbox summary');

  // Only the genuine first load (no cached rows yet) shows the skeleton.
  // A background refetch keeps its previously-fetched data, so we keep the
  // KPIs on screen instead of flashing an empty skeleton grid over them.
  const firstLoad = query.isLoading && rows.length === 0;

  if (firstLoad) {
    return (
      <section aria-label={sectionLabel}>
        <GlassPanel className="px-4 py-3">
          <StatGridSkeleton cards={6} className="sm:grid-cols-3 xl:grid-cols-6 [&>div]:!h-8" />
        </GlassPanel>
      </section>
    );
  }

  if (state.fatalError) {
    return (
      <section aria-label={sectionLabel}>
        <GlassPanel className="p-4 sm:p-5">
          <QueryError
            error={state.fatalError}
            onRetry={() => { void query.refetch(); }}
            resourceName={archived ? t('notifications.archived.summary.resource', 'archived notifications') : t('notifications.inbox.summary.resource', 'notifications')}
          />
        </GlassPanel>
      </section>
    );
  }

  if (stats.total === 0) {
    return (
      <section aria-label={sectionLabel}>
        <GlassPanel className="p-4 sm:p-5">
          <StaleRefreshWarning state={state} label={sectionLabel} />
          <EmptyState
            icon={<Inbox className="h-8 w-8" aria-hidden="true" />}
            message={archived ? t('notifications.archived.summary.empty', 'No archived notifications yet') : t('notifications.inbox.summary.empty', 'No notifications yet')}
            actionTo={archived
              ? { label: t('notifications.archived.summary.cta', 'Go to inbox'), to: '/notifications/inbox' }
              : { label: t('notifications.inbox.summary.cta', 'Manage alert rules'), to: '/notifications/rules' }}
          />
        </GlassPanel>
      </section>
    );
  }

  const lastReceivedValue = stats.lastTs > 0 ? formatRelativeTime(new Date(stats.lastTs)) : '—';
  const lastReceivedSubtitle = stats.lastTs > 0 ? formatDateTime(new Date(stats.lastTs)) : undefined;

  return (
    <section aria-label={sectionLabel}>
      <GlassPanel className="px-4 py-3">
        <StaleRefreshWarning state={state} label={sectionLabel} />
        <div className={gridClass}>
          {[
            { label: archived ? t('notifications.archived.summary.total', 'Total archived') : t('notifications.inbox.summary.total', 'Recent notifications'), value: fmtInt(stats.total), Icon: archived ? Archive : Inbox },
            { label: t('notifications.inbox.summary.unread', 'Unread'), value: fmtInt(stats.unread), Icon: MailWarning },
            { label: t('notifications.inbox.summary.critical', 'Critical'), value: fmtInt(stats.critical), Icon: AlertOctagon },
            { label: t('notifications.inbox.summary.warnings', 'Warnings'), value: fmtInt(stats.warn), Icon: AlertTriangle },
            { label: t('notifications.inbox.summary.info', 'Info'), value: fmtInt(stats.info), Icon: Info },
            { label: archived ? t('notifications.archived.summary.lastArchived', 'Last archived') : t('notifications.inbox.summary.lastReceived', 'Last received'), value: lastReceivedValue, Icon: Clock, title: lastReceivedSubtitle },
          ].map(({ label, value, Icon, title }) => (
            <div key={label} title={title} className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {label}
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-[var(--text-primary)]">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-[var(--border-subtle)] pt-2 text-xs text-[var(--text-muted)]">
          <span>{archived ? t('notifications.archived.summary.recentScope', 'Latest 50 archived entries · all time') : t('notifications.inbox.summary.recentScope', 'Latest 50 active entries · all time')}</span>
          <span>{t('notifications.inbox.summary.unreadOf', '{{unread}} of {{total}}', { unread: stats.unread, total: stats.total })}</span>
          {stats.total > stats.critical + stats.warn + stats.info && (
            <span>{t('notifications.inbox.summary.unknownSeverity', '{{count}} with unknown severity', {
              count: stats.total - stats.critical - stats.warn - stats.info,
            })}</span>
          )}
        </div>
      </GlassPanel>
    </section>
  );
}
