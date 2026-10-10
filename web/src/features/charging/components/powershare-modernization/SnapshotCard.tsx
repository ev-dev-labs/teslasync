import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutCard } from '@/components/layout/layout-reference';
import { Caption, Text, DataTable, useSortToggle, type Column } from '@/components/ui';
import { Skeleton, QueryError } from '@/components/feedback';
import { DateTime } from '@/components/data-display';
import { typography } from '@/lib/tokens';
import { safeArray } from '@/lib/safeArray';
import type { SnapshotRow } from '../powershare';

interface SnapshotCardProps {
  rows: SnapshotRow[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

const snapshotKey = (row: SnapshotRow) => row.key;

function snapshotAccessor(row: SnapshotRow, key: string): number | string {
  if (key === 'ts') return row.ts ? Date.parse(row.ts) : Number.NEGATIVE_INFINITY;
  if (key === 'value') return row.value ?? '';
  return row.label ?? '';
}

/** Retains the production table controller, identity and all mobile columns. */
export function SnapshotCard({ rows, isLoading, error, onRetry }: SnapshotCardProps) {
  const { t } = useTranslation();
  const { sortKey, sortDir, onSort, sortFn } = useSortToggle();
  const columns = useMemo<Column<SnapshotRow>[]>(() => [
    {
      key: 'label', header: t('powershare.snapshot.signal', 'Signal'), sortable: true,
      render: row => <Text size="sm" color="secondary">{row.label}</Text>,
    },
    {
      key: 'value', header: t('powershare.snapshot.value', 'Value'), sortable: true,
      render: row => <Text size="sm" weight="medium" color="primary" className="tabular-nums">{row.value}</Text>,
    },
    {
      key: 'ts', header: t('powershare.snapshot.updated', 'Updated'), sortable: true,
      render: row => row.ts
        ? <DateTime value={row.ts} variant="relative" className={typography.role.caption} />
        : <Caption>—</Caption>,
    },
  ], [t]);
  const sortedRows = useMemo(() => sortFn(safeArray(rows), snapshotAccessor), [sortFn, rows]);

  return (
    <LayoutCard title={t('powershare.snapshot.title', 'Signal Snapshot')}
      description={t('powershare.snapshot.subtitle', 'Latest raw Powershare telemetry')}>
      {isLoading ? <Skeleton height={200} /> : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : (
        <DataTable
          tableId="charging:powershare-signals"
          columns={columns}
          mobileColumns={['label', 'value', 'ts']}
          data={sortedRows}
          keyExtractor={snapshotKey}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          emptyMessage={t('powershare.snapshot.noData', 'No Powershare signals received yet.')}
        />
      )}
    </LayoutCard>
  );
}
