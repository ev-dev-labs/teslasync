import { History } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
import { Button, DataTable, Caption } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { EmptyState, QueryError, Skeleton, SectionErrorBoundary } from '@/components/feedback';
import { AuditExpandedDetail } from '../../continuation-admin-2/AuditExpandedDetail';
import type { useAuditLogPage } from '../../../hooks/useAuditLogPage';
import { useAuditLogColumns } from './auditLogColumns';

type Props = { controller: ReturnType<typeof useAuditLogPage> };

export function AuditLogEntries({ controller }: Props) {
  const { t, limit, offset, setOffset, expanded, setExpanded, logQuery, subsystemMissing, tableError, rows } = controller;
  const columns = useAuditLogColumns(controller);

  return (
<FadeIn delay={0.2}>
        <LayoutCard title={t('admin.auditLog.tableTitle', 'Entries')}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOffset(Math.max(0, offset - Number(limit)))}
                disabled={offset === 0}
              >
                {t('admin.auditLog.prevPage', 'Previous')}
              </Button>
              <Caption>
                {t('admin.auditLog.pageInfo', 'Showing {{from}}–{{to}}', {
                  from: rows.length === 0 ? 0 : offset + 1,
                  to: offset + rows.length,
                })}
              </Caption>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOffset(offset + Number(limit))}
                disabled={rows.length < Number(limit)}
              >
                {t('admin.auditLog.nextPage', 'Next')}
              </Button>
            </div>
          </div>
          <SectionErrorBoundary name="audit-log-table">
            {tableError ? (
              <QueryError error={tableError} onRetry={() => logQuery.refetch()} />
            ) : logQuery.isLoading && rows.length === 0 ? (
              <Skeleton height={320} />
            ) : rows.length === 0 && !subsystemMissing ? (
              // no-action: filter controls live in the panel above; the message guides users to widen or clear them
              <EmptyState
                icon={<History className="h-8 w-8" />}
                title={t('admin.auditLog.emptyTitle', 'No audit entries')}
                message={t(
                  'admin.auditLog.emptyMessage',
                  'No rows match the current filter. Try widening the time range or clearing the filters.',
                )}
              />
            ) : (
              <DataTable
                tableId="admin:audit-log"
                enableValueFilters={false}
                columns={columns}
                mobileColumns={['action', 'success', 'ts']}
                data={rows}
                keyExtractor={(r) => r.id}
                emptyMessage={t('admin.auditLog.emptyTable', 'No entries')}
                expandable
                expandedKeys={expanded}
                onExpandedChange={(next) => setExpanded(next)}
                renderExpanded={(r) => <AuditExpandedDetail row={r} />}
                exportable
                exportFilename={`audit-log-${new Date().toISOString().slice(0, 10)}`}
                exportRow={(row) => ({
                  id: row.id,
                  ts: row.ts,
                  actor: row.actor,
                  category: row.category ?? '',
                  action: row.action,
                  entity_type: row.entity_type,
                  entity_id: row.entity_id ?? '',
                  detail: row.detail ?? '',
                  ip: row.ip ?? '',
                  user_agent: row.user_agent ?? '',
                  trace_id: row.trace_id ?? '',
                  success:
                    row.success === null || row.success === undefined ? '' : String(row.success),
                  prev_row_hash: row.prev_row_hash ?? '',
                  row_hash: row.row_hash ?? '',
                })}
              />
            )}
          </SectionErrorBoundary>
        </LayoutCard>
      </FadeIn>
  );
}
