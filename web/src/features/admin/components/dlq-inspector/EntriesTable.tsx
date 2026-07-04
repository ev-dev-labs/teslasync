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
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Badge,
  Button,
  Caption,
  Code,
  DataTable,
  Text,
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

  const sorted = useMemo(() => {
    // Defensive copy + null-guard: the list endpoint always returns an
    // array, but a mid-flight/undefined `rows` prop must never crash the
    // table (spreading `undefined` throws). Sorting a copy keeps the
    // parent's array immutable.
    const safeRows = rows ?? [];
    return [...safeRows].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'arrived_at': {
          // A single malformed timestamp must not scramble the whole
          // default view — treat an unparseable date as epoch 0.
          const ta = Date.parse(a.arrived_at);
          const tb = Date.parse(b.arrived_at);
          return (
            ((Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb)) * dir
          );
        }
        case 'parsed_reason':
          return (
            (a.parsed_reason ?? '').localeCompare(b.parsed_reason ?? '') * dir
          );
        case 'parsed_vin':
          return (a.parsed_vin ?? '').localeCompare(b.parsed_vin ?? '') * dir;
        case 'raw_payload_size':
          return ((a.raw_payload_size ?? 0) - (b.raw_payload_size ?? 0)) * dir;
        default:
          return 0;
      }
    });
  }, [rows, sortKey, sortDir]);

  const columns = useMemo<Column<DLQEntrySummary>[]>(
    () => [
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
        render: (row) => <Code>{row.parsed_reason || '—'}</Code>,
      },
      {
        key: 'parsed_vin',
        header: t('admin.dlq.cols.vin', 'VIN'),
        sortable: true,
        render: (row) => (
          <Text mono size="xs" color="muted">
            {row.parsed_vin ?? '—'}
          </Text>
        ),
      },
      {
        key: 'parsed_source_topic',
        header: t('admin.dlq.cols.topic', 'Source topic'),
        render: (row) => (
          <Text mono size="xs" color="muted">
            {row.parsed_source_topic ?? '—'}
          </Text>
        ),
      },
      {
        key: 'parsed_redeliveries',
        header: t('admin.dlq.cols.redeliveries', 'Redel.'),
        align: 'right',
        render: (row) =>
          row.parsed_redeliveries != null
            ? fmtInt(row.parsed_redeliveries)
            : '—',
      },
      {
        key: 'raw_payload_size',
        header: t('admin.dlq.cols.size', 'Payload'),
        align: 'right',
        sortable: true,
        render: (row) => <Caption>{formatBytes(row.raw_payload_size)}</Caption>,
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
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onInspect(row)}
            // Every row's button shares the visible label "Inspect"; give
            // screen-reader users a unique, row-scoped accessible name.
            aria-label={t('admin.dlq.actions.inspectRow', 'Inspect DLQ entry {{id}}', {
              id: row.id,
            })}
          >
            {t('admin.dlq.actions.inspect', 'Inspect')}
          </Button>
        ),
      },
    ],
    [t, onInspect],
  );

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
