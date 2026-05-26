/**
 * Ingest X-Ray — per-field statistics table.
 *
 * Sortable by sample_count + last_seen_at so an operator can immediately
 * answer "which field hasn't arrived recently?" or "which field is the
 * loudest?".
 */
import { useTranslation } from 'react-i18next';

import {
  Badge,
  DataTable,
  useSortToggle,
  type Column,
} from '@/components/ui';
import { TimeStamp } from '@/components/data-display';
import { fmtInt } from '@/lib/numberFormat';
import { formatValueKind } from '@/api/hooks/useIngestXRay';
import type { IngestXRayFieldStat } from '@/types/admin-diagnostics';

interface XRayFieldsTableProps {
  rows: IngestXRayFieldStat[];
  loading: boolean;
}

export function XRayFieldsTable({ rows, loading }: XRayFieldsTableProps) {
  const { t } = useTranslation();
  const { sortKey, sortDir, onSort } = useSortToggle('sample_count', 'desc');

  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortKey) {
      case 'field':
        return a.field.localeCompare(b.field) * dir;
      case 'sample_count':
        return (a.sample_count - b.sample_count) * dir;
      case 'last_seen_at':
        return (
          (Date.parse(a.last_seen_at) - Date.parse(b.last_seen_at)) * dir
        );
      case 'value_kind':
        return (a.value_kind - b.value_kind) * dir;
      default:
        return 0;
    }
  });

  const columns: Column<IngestXRayFieldStat>[] = [
    {
      key: 'field',
      header: t('admin.xray.fields.cols.field', 'Field'),
      sortable: true,
      visibleOnMobile: true,
      render: (row) => (
        <span className="font-mono text-sm text-[var(--text-primary)]">
          {row.field}
        </span>
      ),
    },
    {
      key: 'sample_count',
      header: t('admin.xray.fields.cols.count', 'Samples'),
      sortable: true,
      align: 'right',
      visibleOnMobile: true,
      render: (row) => fmtInt(row.sample_count),
    },
    {
      key: 'last_seen_at',
      header: t('admin.xray.fields.cols.lastSeen', 'Last seen'),
      sortable: true,
      visibleOnMobile: true,
      render: (row) => <TimeStamp value={row.last_seen_at} format="relative" />,
    },
    {
      key: 'value_kind',
      header: t('admin.xray.fields.cols.kind', 'Kind'),
      sortable: true,
      render: (row) => (
        <Badge variant="neutral">{formatValueKind(row.value_kind)}</Badge>
      ),
    },
  ];

  return (
    <DataTable<IngestXRayFieldStat>
      tableId="admin:xray-fields"
      name="xray-fields"
      columns={columns}
      data={sorted}
      keyExtractor={(row) => row.field}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={onSort}
      emptyMessage={
        loading
          ? t('admin.xray.fields.loading', 'Loading…')
          : t(
              'admin.xray.fields.empty',
              'No samples in this window. Try widening the window or confirm the vehicle is publishing.',
            )
      }
      pagination={{ defaultPageSize: 50, pageSizeOptions: [25, 50, 100] }}
      mobileColumns={['field', 'sample_count', 'last_seen_at']}
    />
  );
}
