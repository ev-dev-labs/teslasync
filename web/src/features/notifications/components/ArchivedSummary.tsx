/**
 * ArchivedSummary — KPI band for the Archived notifications page.
 *
 * Derives a full-width, responsive metric bento from the unfiltered archived
 * backlog (`useNotificationLogs({ archived: true })`, passed in from the page
 * so it dedupes with the InboxBody's own default fetch). Every state —
 * loading, error, empty — is handled here so the band is self-sufficient and
 * the panel stays visible regardless of data availability.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import { Archive, AlertOctagon, AlertTriangle, Info, MailWarning, Clock } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, StatGridSkeleton } from '@/components/feedback';
import type { NotificationLog } from '@/api/types';
import { formatRelativeTime, formatDateTime } from '@/lib/dateFormat';

export interface ArchivedSummaryProps {
  /** The archived-notifications query (TanStack result) from the page. */
  query: UseQueryResult<NotificationLog[]>;
}

interface ArchivedStats {
  total: number;
  critical: number;
  warn: number;
  info: number;
  unread: number;
  lastTs: number;
}

/** Responsive KPI grid summarising the archived notification backlog. */
export function ArchivedSummary({ query }: ArchivedSummaryProps) {
  const { t } = useTranslation();

  const stats = useMemo<ArchivedStats>(() => {
    const rows = query.data ?? [];
    let critical = 0;
    let warn = 0;
    let info = 0;
    let unread = 0;
    let lastTs = 0;
    for (const row of rows) {
      // `severity` is typed loosely (`string`) and, while the primary write
      // path lowercases it, legacy rows and alternate insert paths may not —
      // normalise here so the KPI counts never silently undercount.
      const severity = (row.severity ?? '').trim().toLowerCase();
      if (severity === 'critical') critical += 1;
      else if (severity === 'warn') warn += 1;
      else if (severity === 'info') info += 1;
      if (!row.read_at) unread += 1;
      const ts = row.archived_at ? new Date(row.archived_at).getTime() : 0;
      if (Number.isFinite(ts) && ts > lastTs) lastTs = ts;
    }
    return { total: rows.length, critical, warn, info, unread, lastTs };
  }, [query.data]);

  const gridClass = 'grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 xl:grid-cols-6';
  const sectionLabel = t('notifications.archived.summary.label', 'Archived summary');

  if (query.isLoading) {
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
            resourceName={t('notifications.archived.summary.resource', 'archived notifications')}
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
            icon={<Archive className="h-8 w-8" aria-hidden="true" />}
            message={t('notifications.archived.summary.empty', 'No archived notifications yet')}
            actionTo={{ label: t('notifications.archived.summary.cta', 'Go to inbox'), to: '/notifications/inbox' }}
          />
        </GlassPanel>
      </section>
    );
  }

  const lastArchivedValue = stats.lastTs > 0 ? formatRelativeTime(new Date(stats.lastTs)) : '—';
  const lastArchivedSubtitle = stats.lastTs > 0 ? formatDateTime(new Date(stats.lastTs)) : undefined;

  return (
    <section aria-label={sectionLabel} className={gridClass}>
      <MetricCard
        label={t('notifications.archived.summary.total', 'Total archived')}
        value={stats.total}
        icon={<Archive className="h-5 w-5" aria-hidden="true" />}
      />
      <MetricCard
        label={t('notifications.archived.summary.critical', 'Critical')}
        value={stats.critical}
        icon={<AlertOctagon className="h-5 w-5" aria-hidden="true" />}
        color="red"
      />
      <MetricCard
        label={t('notifications.archived.summary.warnings', 'Warnings')}
        value={stats.warn}
        icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
        color="amber"
      />
      <MetricCard
        label={t('notifications.archived.summary.info', 'Info')}
        value={stats.info}
        icon={<Info className="h-5 w-5" aria-hidden="true" />}
        color="blue"
      />
      <MetricCard
        label={t('notifications.archived.summary.unread', 'Unread')}
        value={stats.unread}
        icon={<MailWarning className="h-5 w-5" aria-hidden="true" />}
        color="purple"
      />
      <MetricCard
        label={t('notifications.archived.summary.lastArchived', 'Last archived')}
        value={lastArchivedValue}
        subtitle={lastArchivedSubtitle}
        icon={<Clock className="h-5 w-5" aria-hidden="true" />}
      />
    </section>
  );
}
