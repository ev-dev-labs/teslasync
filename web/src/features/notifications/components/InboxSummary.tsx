/**
 * InboxSummary — KPI band for the active Notifications inbox.
 *
 * Derives a full-width, responsive metric bento from the unfiltered active
 * backlog (`useNotificationLogs({ archived: false })`, passed in from the page
 * so it can dedupe with the InboxBody's own fetch). Leads with the unread
 * count — the inbox's primary triage metric — then breaks the backlog down by
 * severity and surfaces how recently the newest notification arrived.
 *
 * Every state — loading, error, empty — is handled here so the band stays
 * self-sufficient and the panel remains visible regardless of data
 * availability. Mirrors `ArchivedSummary` for a connected, consistent feel
 * across the two notification surfaces.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import { Inbox, MailWarning, AlertOctagon, AlertTriangle, Info, Clock } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, StatGridSkeleton } from '@/components/feedback';
import type { NotificationLog } from '@/api/types';
import { formatRelativeTime, formatDateTime } from '@/lib/dateFormat';

export interface InboxSummaryProps {
  /** The active (non-archived) notifications query (TanStack result) from the page. */
  query: UseQueryResult<NotificationLog[]>;
}

interface InboxStats {
  total: number;
  unread: number;
  critical: number;
  warn: number;
  info: number;
  lastTs: number;
}

/** Responsive KPI grid summarising the active notification backlog. */
export function InboxSummary({ query }: InboxSummaryProps) {
  const { t } = useTranslation();
  const rows = query.data ?? [];

  const stats = useMemo<InboxStats>(() => {
    let unread = 0;
    let critical = 0;
    let warn = 0;
    let info = 0;
    let lastTs = 0;
    for (const row of rows) {
      const severity = row.severity ?? '';
      if (severity === 'critical') critical += 1;
      else if (severity === 'warn') warn += 1;
      else if (severity === 'info') info += 1;
      if (!row.read_at) unread += 1;
      const ts = row.created_at ? new Date(row.created_at).getTime() : 0;
      if (Number.isFinite(ts) && ts > lastTs) lastTs = ts;
    }
    return { total: rows.length, unread, critical, warn, info, lastTs };
  }, [rows]);

  const gridClass = 'grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 xl:grid-cols-6';
  const sectionLabel = t('notifications.inbox.summary.label', 'Inbox summary');

  // Only the genuine first load (no cached rows yet) shows the skeleton.
  // A background refetch keeps its previously-fetched data, so we keep the
  // KPIs on screen instead of flashing an empty skeleton grid over them.
  const firstLoad = query.isLoading && rows.length === 0;

  if (firstLoad) {
    return (
      <section aria-label={sectionLabel}>
        <StatGridSkeleton cards={6} />
      </section>
    );
  }

  if (query.isError) {
    return (
      <section aria-label={sectionLabel}>
        <GlassPanel className="p-4 sm:p-5">
          <QueryError
            error={query.error}
            onRetry={() => { void query.refetch(); }}
            resourceName={t('notifications.inbox.summary.resource', 'notifications')}
          />
        </GlassPanel>
      </section>
    );
  }

  if (stats.total === 0) {
    return (
      <section aria-label={sectionLabel}>
        <GlassPanel className="p-4 sm:p-5">
          <EmptyState
            icon={<Inbox className="h-8 w-8" aria-hidden="true" />}
            message={t('notifications.inbox.summary.empty', 'No notifications yet')}
            actionTo={{ label: t('notifications.inbox.summary.cta', 'Manage alert rules'), to: '/notifications/rules' }}
          />
        </GlassPanel>
      </section>
    );
  }

  const lastReceivedValue = stats.lastTs > 0 ? formatRelativeTime(new Date(stats.lastTs)) : '—';
  const lastReceivedSubtitle = stats.lastTs > 0 ? formatDateTime(new Date(stats.lastTs)) : undefined;

  return (
    <section aria-label={sectionLabel} className={gridClass}>
      <MetricCard
        label={t('notifications.inbox.summary.total', 'Total')}
        value={stats.total}
        icon={<Inbox className="h-5 w-5" aria-hidden="true" />}
      />
      <MetricCard
        label={t('notifications.inbox.summary.unread', 'Unread')}
        value={stats.unread}
        subtitle={t('notifications.inbox.summary.unreadOf', '{{unread}} of {{total}}', {
          unread: stats.unread,
          total: stats.total,
        })}
        icon={<MailWarning className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
      />
      <MetricCard
        label={t('notifications.inbox.summary.critical', 'Critical')}
        value={stats.critical}
        icon={<AlertOctagon className="h-5 w-5" aria-hidden="true" />}
        color="red"
      />
      <MetricCard
        label={t('notifications.inbox.summary.warnings', 'Warnings')}
        value={stats.warn}
        icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
        color="amber"
      />
      <MetricCard
        label={t('notifications.inbox.summary.info', 'Info')}
        value={stats.info}
        icon={<Info className="h-5 w-5" aria-hidden="true" />}
        color="blue"
      />
      <MetricCard
        label={t('notifications.inbox.summary.lastReceived', 'Last received')}
        value={lastReceivedValue}
        subtitle={lastReceivedSubtitle}
        icon={<Clock className="h-5 w-5" aria-hidden="true" />}
      />
    </section>
  );
}
