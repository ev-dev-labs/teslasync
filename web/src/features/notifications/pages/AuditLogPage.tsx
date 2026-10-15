/**
 * AuditLogPage — searchable view of system-level audit entries.
 *
 * Replaces the audit log panel that used to live on the now-deleted
 * /admin page. Reads from the same `useAuditLogs()` hook (GET
 * /api/v1/system/audit) and renders the same DataTable + search +
 * active-filter chip combo, but at a discoverable, dedicated URL
 * (/notifications/audit).
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { PageLayout } from '@/components/layout';
import { DataTable, GlassPanel, Icon, PanelTitle, Text, type Column } from '@/components/ui';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  SearchInput,
  FilterBar,
  ActiveFilterChips,
  type FilterChipDescriptor,
} from '@/components/forms';
import { useFilteredList } from '@/hooks/useFilteredList';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { formatDateTime } from '@/lib/dateFormat';
import { typography } from '@/lib/tokens';
import { useAuditLogs } from '@/api/hooks/useAdmin';
import type { AuditLogEntry } from '@/types/admin';

export default function AuditLogPage() {
  const { t } = useTranslation();
  usePageTitle(t('audit.title', 'Audit log'));
  const auditQuery = useAuditLogs();
  const auditState = useDataState(auditQuery, { provenance: 'historical' });
  const { data: auditLogs } = auditQuery;
  const isLoading = auditState.status === 'initial';
  const error = auditState.fatalError;

  const [search, setSearch] = useState('');
  const searchFields = useMemo(
    () =>
      ['action', 'resource', 'details'] as const satisfies ReadonlyArray<keyof AuditLogEntry>,
    [],
  );
  const filtered = useFilteredList(
    auditLogs as AuditLogEntry[] | undefined,
    search,
    searchFields,
  );

  const columns: Column<AuditLogEntry>[] = useMemo(
    () => [
      {
        key: 'time',
        header: t('audit.time', 'Time'),
        render: (log) => (
          <Text variant="caption" mono className="whitespace-normal break-words">
            {formatDateTime(log.createdAt)}
          </Text>
        ),
      },
      {
        key: 'action',
        header: t('audit.action', 'Action'),
        render: (log) => <Text variant="bodySm" className="break-words">{log.action ?? '—'}</Text>,
      },
      {
        key: 'resource',
        header: t('audit.resource', 'Resource'),
        render: (log) => <Text variant="bodySm" mono className="break-words">{log.resource ?? '—'}</Text>,
      },
      {
        key: 'details',
        header: t('audit.details', 'Details'),
        render: (log) => (
          <Text variant="bodySm" color="secondary" className="whitespace-pre-wrap break-words">
            {log.details ?? '—'}
          </Text>
        ),
      },
    ],
    [t],
  );

  return (
    <PageLayout
      title={t('audit.title', 'Audit log')}
      subtitle={t('audit.subtitle', 'Recent system-level changes recorded by the audit subsystem')}
    >
      <StaleRefreshWarning state={auditState} label={t('audit.title', 'Audit log')} />
      <FadeIn>
        <GlassPanel className="min-w-0 p-4 sm:p-6">
          <PanelTitle className="mb-4 flex items-center gap-2">
            <Icon icon={Clock} size="lg" className={typography.color.muted} />
            {t('audit.recentActivity', 'Recent activity')}
          </PanelTitle>

          {isLoading && auditState.isRefreshBlocked ? (
            <EmptyState
              title={t('error.waiting.title', 'Waiting for upstream')}
              message={t('error.waiting.retryMessage', 'Requests are paused briefly. Wait before retrying.')}
              action={{ label: t('common.retry', 'Retry'), onClick: () => { void auditQuery.refetch(); } }}
              className="py-6"
            />
          ) : isLoading ? (
            <div role="status" aria-label={t('developerReference.layout.source.loading', 'Loading {{label}}', { label: t('audit.title', 'Audit log') })} className="space-y-2 mt-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : error ? (
            <QueryError
              compact
              className="mt-4"
              error={error}
              message={[
                t('audit.loadFailed', 'Failed to load audit logs'),
                error.message || t('audit.loadError.unknown', 'Unknown error'),
              ].join(': ')}
              onRetry={() => { void auditQuery.refetch(); }}
            />
          ) : (auditLogs as AuditLogEntry[])?.length ? (
            <div className="mt-4">
              <FilterBar className="mb-3">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder={t(
                    'audit.searchPlaceholder',
                    'Search by action, resource, or details…',
                  )}
                  className="w-full sm:w-72"
                  historyScope="audit"
                />
              </FilterBar>
              <ActiveFilterChips
                className="mb-3"
                filters={
                  (search
                    ? [
                        {
                          key: 'q',
                          label: t('audit.filterLabel.search', 'Search'),
                          value: search,
                          onRemove: () => setSearch(''),
                        } satisfies FilterChipDescriptor,
                      ]
                    : []) as readonly FilterChipDescriptor[]
                }
                onClearAll={() => setSearch('')}
              />
              {filtered.length > 0 ? (
                <DataTable
                  tableId="audit-logs"
                  caption={t('audit.recentActivity', 'Recent activity')}
                  columns={columns}
                  mobileColumns={['time', 'action', 'resource', 'details']}
                  data={filtered}
                  keyExtractor={(log) => String(log.id)}
                  compact
                  exportable
                  exportFilename="audit-logs"
                  pagination={{ defaultPageSize: 50 }}
                />
              ) : (
                <EmptyState message={t('audit.noMatches', 'No audit entries match your search.')} className="py-6" />
              )}
            </div>
          ) : (
            <EmptyState message={t('audit.noEntries', 'No audit entries found')} className="py-6" />
          )}
        </GlassPanel>
      </FadeIn>
    </PageLayout>
  );
}
