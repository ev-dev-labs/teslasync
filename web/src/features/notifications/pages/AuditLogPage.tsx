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
import { Clock, AlertTriangle } from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { PanelTitle } from '@/components/ui';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FadeIn } from '@/components/motion/FadeIn';
import {
  SearchInput,
  FilterBar,
  ActiveFilterChips,
  type FilterChipDescriptor,
} from '@/components/forms';
import { useFilteredList } from '@/hooks/useFilteredList';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import { useAuditLogs } from '@/api/hooks/useAdmin';
import type { AuditLogEntry } from '@/types/admin';

export default function AuditLogPage() {
  const { t } = useTranslation();
  usePageTitle(t('Audit Log'));
  const { data: auditLogs, isLoading, error } = useAuditLogs();

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
        header: t('Time'),
        render: (log) => (
          <span className="text-xs font-mono whitespace-nowrap text-[var(--text-muted)]">
            {formatDateTime(log.createdAt)}
          </span>
        ),
      },
      {
        key: 'action',
        header: t('Action'),
        render: (log) => <span className="text-[var(--text-primary)]">{log.action ?? '—'}</span>,
      },
      {
        key: 'resource',
        header: t('Resource'),
        render: (log) => <span className="font-mono text-cyan-300">{log.resource ?? '—'}</span>,
      },
      {
        key: 'details',
        header: t('Details'),
        render: (log) => (
          <span className="text-xs truncate max-w-xs text-[var(--text-muted)]">
            {log.details ?? '—'}
          </span>
        ),
      },
    ],
    [t],
  );

  return (
    <PageContainer
      title={t('Audit Log')}
      subtitle={t('Recent system-level changes recorded by the audit subsystem')}
    >
      <FadeIn>
        <GlassPanel className="p-6">
          <PanelTitle className="mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-neon-cyan" aria-hidden="true" />
            {t('Recent Activity')}
          </PanelTitle>

          {isLoading ? (
            <div className="space-y-2 mt-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : error ? (
            <span role="alert" className="text-sm text-rose-300 flex items-center gap-2 mt-4">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />{' '}
              {t('Failed to load audit logs')}:{' '}
              {(error instanceof Error && error.message) ||
                t('audit.loadError.unknown', 'Unknown error')}
            </span>
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
                  columns={columns}
                  data={filtered}
                  keyExtractor={(log) => String(log.id)}
                  compact
                  exportable
                  exportFilename="audit-logs"
                  pagination={{ defaultPageSize: 50 }}
                />
              ) : (
                <span className="text-sm text-[var(--text-muted)] block">
                  {t('audit.noMatches', 'No audit entries match your search.')}
                </span>
              )}
            </div>
          ) : (
            <span className="text-sm text-[var(--text-muted)] mt-4 block">
              {t('No audit entries found')}
            </span>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
