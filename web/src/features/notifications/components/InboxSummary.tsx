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
import { OperationalBrief, DataProvenanceBadge, type StatMetric } from '@/components/data-display';
import { EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import type { NotificationLog } from '@/api/types';
import { formatRelativeTime, formatDateTime } from '@/lib/dateFormat';

import { useDataState } from '@/hooks/useDataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

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

  const sectionLabel = archived ? t('notifications.archived.summary.label', 'Archived summary') : t('notifications.inbox.summary.label', 'Inbox summary');

  // Only the genuine first load (no cached rows yet) shows the skeleton.
  // A background refetch keeps its previously-fetched data, so we keep the
  // KPIs on screen instead of flashing an empty skeleton grid over them.
  const firstLoad = query.isLoading && rows.length === 0;
  const scope = archived ? t('notifications.archived.summary.recentScope', 'Latest 50 archived entries · all time') : t('notifications.inbox.summary.recentScope', 'Latest 50 active entries · all time');
  const provenance = t('notifications.inbox.summary.brief.provenance', 'Counts describe this bounded unfiltered sample, not the workspace period or the server total. Missing read timestamps count as unread.');
  const lastReceivedValue = stats.lastTs > 0 ? formatRelativeTime(new Date(stats.lastTs)) : null;
  const lastReceivedSubtitle = stats.lastTs > 0 ? formatDateTime(new Date(stats.lastTs)) : undefined;
  const metrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'inbox-total', rawValue: state.hasData ? stats.total : null,
      label: archived ? t('notifications.archived.summary.total', 'Total archived') : t('notifications.inbox.summary.total', 'Recent notifications'),
      context: <>{archived ? <Archive className="h-3.5 w-3.5" aria-hidden="true" /> : <Inbox className="h-3.5 w-3.5" aria-hidden="true" />}</> },
    { metricId: 'count', occurrenceId: 'inbox-unread', rawValue: state.hasData ? stats.unread : null,
      label: t('notifications.inbox.summary.unread', 'Unread'),
      context: <><MailWarning className="h-3.5 w-3.5" aria-hidden="true" />{t('notifications.inbox.summary.unreadOf', '{{unread}} of {{total}}', { unread: stats.unread, total: stats.total })}</> },
    { metricId: 'count', occurrenceId: 'inbox-critical', rawValue: state.hasData ? stats.critical : null,
      label: t('notifications.inbox.summary.critical', 'Critical'), context: <AlertOctagon className="h-3.5 w-3.5" aria-hidden="true" /> },
    { metricId: 'count', occurrenceId: 'inbox-warn', rawValue: state.hasData ? stats.warn : null,
      label: t('notifications.inbox.summary.warnings', 'Warnings'), context: <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> },
    { metricId: 'count', occurrenceId: 'inbox-info', rawValue: state.hasData ? stats.info : null,
      label: t('notifications.inbox.summary.info', 'Info'), context: <Info className="h-3.5 w-3.5" aria-hidden="true" /> },
    { metricId: 'text', occurrenceId: 'inbox-last', rawValue: lastReceivedValue,
      label: archived ? t('notifications.archived.summary.lastArchived', 'Last archived') : t('notifications.inbox.summary.lastReceived', 'Last received'),
      context: <><Clock className="h-3.5 w-3.5" aria-hidden="true" />{lastReceivedSubtitle}</> },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);

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

  if (!firstLoad && stats.total === 0) {
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

  return (
    <section aria-label={sectionLabel}>
      <StaleRefreshWarning state={state} label={sectionLabel} />
      <OperationalBrief compact loading={firstLoad} testId="notification-backlog-brief"
        eyebrow={sectionLabel}
        title={t('notifications.inbox.summary.brief.title', 'Backlog severity and read status')}
        description={provenance}
        statusLabel={firstLoad ? t('common.loading', 'Loading…') : state.isRefreshBlocked
          ? t('fleetOps.brief.refreshBlocked', 'Refresh paused')
          : state.status === 'stale' ? t('dataState.stale.title', 'Data may be stale')
            : t('notifications.inbox.summary.brief.available', 'Sample loaded')}
        statusTone={!firstLoad && (state.isRefreshBlocked || state.status === 'stale') ? 'warning' : 'neutral'}
        metrics={operationalMetrics} scope={scope}
        freshness={<DataProvenanceBadge provenance={state.provenance} status={state.status} updatedAt={state.updatedAt} />}
        provenance={`${scope}. ${provenance}`}
        attention={stats.total > stats.critical + stats.warn + stats.info ? [{
          key: 'unknown-severity', title: t('notifications.inbox.summary.brief.unknown', 'Unknown severity'),
          description: t('notifications.inbox.summary.unknownSeverity', '{{count}} with unknown severity', {
            count: stats.total - stats.critical - stats.warn - stats.info,
          }),
        }] : []}
      />
    </section>
  );
}
