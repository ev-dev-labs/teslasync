/**
 * Ingest X-Ray — per-field statistics table.
 *
 * Sortable by sample_count + last_seen_at so an operator can immediately
 * answer "which field hasn't arrived recently?" or "which field is the
 * loudest?".
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Badge,
  DataTable,
  Text,
  useSortToggle,
  type Column,
  type MobileDataTablePresentation,
} from '@/components/ui';
import { TimeStamp } from '@/components/data-display';

import { formatValueKind } from '@/api/hooks/useIngestXRay';
import type { IngestXRayFieldStat } from '@/types/admin-diagnostics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { knownNumber } from '@/api/dataState';

interface XRayFieldsTableProps {
  rows: IngestXRayFieldStat[];
  loading: boolean;
}

/**
 * Parse an ISO timestamp to epoch millis for comparison. A missing or
 * unparseable value collapses to 0 so it deterministically sorts as the
 * "oldest" row instead of yielding `NaN` — a `NaN` comparator result leaves
 * the sort in an implementation-defined, unstable order, which is exactly
 * the wrong behaviour for the "which field hasn't arrived recently?" view.
 */
function lastSeenEpoch(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

export function XRayFieldsTable({ rows, loading }: XRayFieldsTableProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { sortKey, sortDir, onSort } = useSortToggle('sample_count', 'desc');
  const countLabel = useMemo(
    () => (row: IngestXRayFieldStat) => {
      const count = knownNumber(row.sample_count);
      return count === null ? '—' : fmtInt(count);
    },
    [fmtInt],
  );
  const kindLabel = useMemo(
    () => (row: IngestXRayFieldStat) => {
      const kind = row.value_kind ?? 0;
      return kind >= 0 && kind <= 10 && Number.isInteger(kind)
        ? formatValueKind(kind)
        : t('admin.xray.fields.kindFallback', 'kind {{kind}}', { kind });
    },
    [t],
  );

  // Sorting a copy is cheap but not free at 100+ rows on a 10 s refetch; only
  // recompute when the data or the sort key/direction actually changes.
  const sorted = useMemo(() => {
    const safeRows = rows ?? [];
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...safeRows].sort((a, b) => {
      switch (sortKey) {
        case 'field':
          return (a.field ?? '').localeCompare(b.field ?? '') * dir;
        case 'sample_count': {
          const left = knownNumber(a.sample_count);
          const right = knownNumber(b.sample_count);
          if (left === null) return right === null ? 0 : 1;
          if (right === null) return -1;
          return (left - right) * dir;
        }
        case 'last_seen_at':
          return (lastSeenEpoch(a.last_seen_at) - lastSeenEpoch(b.last_seen_at)) * dir;
        case 'value_kind':
          return ((a.value_kind ?? 0) - (b.value_kind ?? 0)) * dir;
        default:
          return 0;
      }
    });
  }, [rows, sortKey, sortDir]);

  const columns: Column<IngestXRayFieldStat>[] = useMemo(
    () => [
      {
        key: 'field',
        filterValue: (row) => row.field ?? null,
        header: t('admin.xray.fields.cols.field', 'Field'),
        sortable: true,
        visibleOnMobile: true,
        render: (row) => (
          <Text mono size="sm" color="primary">
            {row.field ?? '—'}
          </Text>
        ),
      },
      {
        key: 'sample_count',
        filterValue: (row) => knownNumber(row.sample_count),
        filterValueLabel: (_value, row) => countLabel(row),
        header: t('admin.xray.fields.cols.count', 'Samples'),
        sortable: true,
        align: 'right',
        visibleOnMobile: true,
        render: countLabel,
      },
      {
        key: 'last_seen_at',
        filterValue: (row) => row.last_seen_at ?? null,
        header: t('admin.xray.fields.cols.lastSeen', 'Last seen'),
        sortable: true,
        visibleOnMobile: true,
        render: (row) => <TimeStamp value={row.last_seen_at} format="relative" />,
      },
      {
        key: 'value_kind',
        filterValue: (row) => row.value_kind ?? null,
        filterValueLabel: (_value, row) => kindLabel(row),
        header: t('admin.xray.fields.cols.kind', 'Kind'),
        sortable: true,
        render: (row) => (
          <Badge variant="neutral">{kindLabel(row)}</Badge>
        ),
      },
    ],
    [t, countLabel, kindLabel],
  );

  const mobilePresentation = useMemo<MobileDataTablePresentation<IngestXRayFieldStat>>(
    () => ({
      roles: { field: 'title', sample_count: 'primary', last_seen_at: 'meta', value_kind: 'badge' },
      displayValue: (row, key) => {
        switch (key) {
          case 'field': return row.field ?? '—';
          case 'sample_count': return countLabel(row);
          case 'last_seen_at': return row.last_seen_at ?? '—';
          case 'value_kind': return kindLabel(row);
          default: return null;
        }
      },
      state: loading && sorted.length === 0 ? { kind: 'loading' } : { kind: 'ready' },
    }),
    [countLabel, kindLabel, loading, sorted.length],
  );

  return (
    <DataTable<IngestXRayFieldStat>
      tableId="admin:xray-fields"
      name="xray-fields"
      columns={columns}
      data={sorted}
      enableValueFilters
      keyExtractor={(row) => row.field ?? '—'}
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
      mobilePresentation={mobilePresentation}
    />
  );
}
