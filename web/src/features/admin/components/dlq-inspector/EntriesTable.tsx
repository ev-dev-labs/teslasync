/**
 * DLQ Inspector — entries table.
 *
 * Renders the list of DLQ rows with sortable columns + an Inspect action
 * per row. Selection state is owned by the parent page so it can decide
 * whether to open the drawer.
 *
 * No raw `<table>` / `<button>` — every interactive surface is a shared
 * UI primitive (DataTable, Button) so audit-touch-target / a11y rules
 * apply consistently.
 */
import { useTranslation } from 'react-i18next';

import {
  Badge,
  Button,
  DataTable,
  useSortToggle,
  type Column,
} from '@/components/ui';
import { TimeStamp } from '@/components/data-display';
import { fmtInt } from '@/lib/numberFormat';
import type { DLQEntrySummary } from '@/types/admin-diagnostics';

interface EntriesTableProps {
  rows: DLQEntrySummary[];
  loading: boolean;
  onInspect: (entry: DLQEntrySummary) => void;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function EntriesTable({ rows, loading, onInspect }: EntriesTableProps) {
  const { t } = useTranslation();
  const { sortKey, sortDir, onSort } = useSortToggle('arrived_at', 'desc');

  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortKey) {
      case 'arrived_at':
        return (
          (Date.parse(a.arrived_at) - Date.parse(b.arrived_at)) * dir
        );
      case 'parsed_reason':
        return a.parsed_reason.localeCompare(b.parsed_reason) * dir;
      case 'parsed_vin':
        return (a.parsed_vin ?? '').localeCompare(b.parsed_vin ?? '') * dir;
      case 'raw_payload_size':
        return (a.raw_payload_size - b.raw_payload_size) * dir;
      default:
        return 0;
    }
  });

  const columns: Column<DLQEntrySummary>[] = [
    {
      key: 'arrived_at',
      header: t('admin.dlq.cols.arrived', 'Arrived'),
      sortable: true,
      visibleOnMobile: true,
      render: (row) => <TimeStamp value={row.arrived_at} format="absolute" />,
    },
    {
      key: 'parsed_reason',
      header: t('admin.dlq.cols.reason', 'Reason'),
      sortable: true,
      visibleOnMobile: true,
      render: (row) => (
        <span className="font-mono text-xs text-[var(--text-primary)]">
          {row.parsed_reason || '—'}
        </span>
      ),
    },
    {
      key: 'parsed_vin',
      header: t('admin.dlq.cols.vin', 'VIN'),
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs text-[var(--text-muted)]">
          {row.parsed_vin ?? '—'}
        </span>
      ),
    },
    {
      key: 'parsed_source_topic',
      header: t('admin.dlq.cols.topic', 'Source topic'),
      render: (row) => (
        <span className="font-mono text-xs text-[var(--text-muted)]">
          {row.parsed_source_topic ?? '—'}
        </span>
      ),
    },
    {
      key: 'parsed_redeliveries',
      header: t('admin.dlq.cols.redeliveries', 'Redel.'),
      align: 'right',
      render: (row) =>
        row.parsed_redeliveries != null ? fmtInt(row.parsed_redeliveries) : '—',
    },
    {
      key: 'raw_payload_size',
      header: t('admin.dlq.cols.size', 'Payload'),
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--text-muted)]">
          {formatBytes(row.raw_payload_size)}
        </span>
      ),
    },
    {
      key: 'replayable',
      header: t('admin.dlq.cols.replayable', 'Replayable'),
      render: (row) =>
        row.replayable ? (
          <Badge variant="success">{t('common.yes', 'Yes')}</Badge>
        ) : (
          <Badge variant="neutral">{t('common.no', 'No')}</Badge>
        ),
    },
    {
      key: 'actions',
      header: t('admin.dlq.cols.actions', 'Actions'),
      visibleOnMobile: true,
      render: (row) => (
        <Button size="sm" variant="secondary" onClick={() => onInspect(row)}>
          {t('admin.dlq.actions.inspect', 'Inspect')}
        </Button>
      ),
    },
  ];

  return (
    <DataTable<DLQEntrySummary>
      tableId="admin:dlq-entries"
      name="dlq-entries"
      columns={columns}
      data={sorted}
      keyExtractor={(row) => row.id}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={onSort}
      emptyMessage={
        loading
          ? t('admin.dlq.table.loading', 'Loading…')
          : t('admin.dlq.table.empty', 'No DLQ entries — the pipeline is clean.')
      }
      pagination={{ defaultPageSize: 25, pageSizeOptions: [25, 50, 100] }}
      mobileColumns={['arrived_at', 'parsed_reason', 'actions']}
    />
  );
}
