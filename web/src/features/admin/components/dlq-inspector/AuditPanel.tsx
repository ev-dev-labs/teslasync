/**
 * DLQ Inspector — replay-audit panel.
 *
 * Renders the recent replay-audit log either globally or scoped to a
 * single DLQ entry. The panel is always mounted so the loading + empty
 * states render in-place rather than gating the entire surface.
 */
import { useTranslation } from 'react-i18next';

import { Badge, DataTable, type Column } from '@/components/ui';
import { TimeStamp } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import type {
  DLQReplayAuditRecord,
  DLQReplayResult,
} from '@/types/admin-diagnostics';

interface AuditPanelProps {
  rows: DLQReplayAuditRecord[];
  loading: boolean;
  scopedDlqId?: number | null;
}

const RESULT_VARIANT: Record<DLQReplayResult, 'success' | 'danger' | 'warning' | 'neutral'> = {
  ok: 'success',
  publish_failed: 'danger',
  rate_limited: 'warning',
  disabled: 'warning',
  not_found: 'neutral',
  unparseable: 'danger',
};

export function AuditPanel({ rows, loading, scopedDlqId }: AuditPanelProps) {
  const { t } = useTranslation();

  const columns: Column<DLQReplayAuditRecord>[] = [
    {
      key: 'replayed_at',
      header: t('admin.dlq.audit.cols.replayedAt', 'Replayed at'),
      visibleOnMobile: true,
      render: (row) => <TimeStamp value={row.replayed_at} format="absolute" />,
    },
    {
      key: 'actor',
      header: t('admin.dlq.audit.cols.actor', 'Actor'),
      visibleOnMobile: true,
      render: (row) => (
        <span className="font-mono text-xs text-[var(--text-muted)]">
          {row.actor || '—'}
        </span>
      ),
    },
    {
      key: 'dlq_id',
      header: t('admin.dlq.audit.cols.dlqId', 'DLQ ID'),
      render: (row) => (
        <span className="font-mono text-xs">{row.dlq_id}</span>
      ),
    },
    {
      key: 'result',
      header: t('admin.dlq.audit.cols.result', 'Result'),
      visibleOnMobile: true,
      render: (row) => (
        <Badge variant={RESULT_VARIANT[row.result] ?? 'neutral'}>
          {row.result}
        </Badge>
      ),
    },
    {
      key: 'dst_topic',
      header: t('admin.dlq.audit.cols.dstTopic', 'Destination'),
      render: (row) => (
        <span className="font-mono text-xs text-[var(--text-muted)]">
          {row.dst_topic || '—'}
        </span>
      ),
    },
    {
      key: 'error',
      header: t('admin.dlq.audit.cols.error', 'Error'),
      render: (row) => (
        <span className="text-xs text-[var(--text-muted)]">
          {row.error || '—'}
        </span>
      ),
    },
    {
      key: 'trace_id',
      header: t('admin.dlq.audit.cols.traceId', 'Trace ID'),
      render: (row) => (
        <span className="font-mono text-xs text-[var(--text-muted)]">
          {row.trace_id || '—'}
        </span>
      ),
    },
  ];

  if (!loading && rows.length === 0) {
    return (
      <EmptyState
        title={t('admin.dlq.audit.empty.title', 'No replay attempts yet')}
        message={
          scopedDlqId
            ? t(
                'admin.dlq.audit.empty.scopedMessage',
                'This entry has not been replayed. Use the Replay action above to send it back to its source topic.',
              )
            : t(
                'admin.dlq.audit.empty.globalMessage',
                'Replay attempts will appear here once an operator triggers one.',
              )
        }
        // no-action: panel sits beneath the live trigger surface; no separate CTA needed.
      />
    );
  }

  return (
    <DataTable<DLQReplayAuditRecord>
      tableId={scopedDlqId ? 'admin:dlq-audit-scoped' : 'admin:dlq-audit'}
      name="dlq-audit"
      columns={columns}
      data={rows}
      keyExtractor={(row) => row.id}
      emptyMessage={
        loading
          ? t('admin.dlq.audit.loading', 'Loading audit log…')
          : t('admin.dlq.audit.empty.title', 'No replay attempts yet')
      }
      pagination={{ defaultPageSize: 25, pageSizeOptions: [25, 50, 100] }}
      mobileColumns={['replayed_at', 'actor', 'result']}
    />
  );
}
