import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ListTree } from 'lucide-react';

import { GlassPanel, PanelTitle, Caption, Text, DataTable, useSortToggle, type Column } from '@/components/ui';
import { Skeleton, QueryError } from '@/components/feedback';
import { DateTime } from '@/components/data-display';
import { typography } from '@/lib/tokens';

import type { SnapshotRow } from './constants';

interface SignalSnapshotPanelProps {
  rows: SnapshotRow[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/** Stable row-key accessor — kept module-level so its identity never changes
 *  across renders (the DataTable memoizes `data.map(keyExtractor)` on it). */
const snapshotKey = (row: SnapshotRow) => row.key;

/**
 * Sort accessor for the snapshot table. The `Value` column mixes formatted
 * strings across heterogeneous signals ("Active", "Home", "5 kW", "—"), so it
 * sorts lexically; `Updated` sorts chronologically with a missing timestamp
 * pinned to the oldest end so a null `ts` never poisons the comparison.
 */
function snapshotAccessor(row: SnapshotRow, key: string): number | string {
  if (key === 'ts') return row.ts ? Date.parse(row.ts) : Number.NEGATIVE_INFINITY;
  if (key === 'value') return row.value ?? '';
  return row.label ?? '';
}

/** Full-width detail band — the latest raw value + timestamp for every
 *  Powershare signal feeding this page. */
export function SignalSnapshotPanel({ rows, isLoading, error, onRetry }: SignalSnapshotPanelProps) {
  const { t } = useTranslation();
  const { sortKey, sortDir, onSort, sortFn } = useSortToggle();

  const columns = useMemo<Column<SnapshotRow>[]>(
    () => [
      {
        key: 'label',
        header: t('powershare.snapshot.signal', 'Signal'),
        sortable: true,
        render: (row) => (
          <Text size="sm" color="secondary">{row.label}</Text>
        ),
      },
      {
        key: 'value',
        header: t('powershare.snapshot.value', 'Value'),
        sortable: true,
        render: (row) => (
          <Text size="sm" weight="medium" color="primary" className="tabular-nums">
            {row.value}
          </Text>
        ),
      },
      {
        key: 'ts',
        header: t('powershare.snapshot.updated', 'Updated'),
        sortable: true,
        render: (row) =>
          row.ts ? (
            <DateTime value={row.ts} variant="relative" className={typography.role.caption} />
          ) : (
            <Caption>—</Caption>
          ),
      },
    ],
    [t],
  );

  // Null-safe before the DataTable iterates, and honour the header sort
  // controls the columns advertise (`sortable: true`) — without wiring
  // `useSortToggle` those buttons render but do nothing.
  const sortedRows = useMemo(() => sortFn(rows ?? [], snapshotAccessor), [sortFn, rows]);

  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <ListTree className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('powershare.snapshot.title', 'Signal Snapshot')}
        </PanelTitle>
        <Caption>{t('powershare.snapshot.subtitle', 'Latest raw Powershare telemetry')}</Caption>
      </div>
      {isLoading ? (
        <Skeleton height={200} />
      ) : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : (
        <DataTable
          tableId="charging:powershare-signals"
          columns={columns}
          data={sortedRows}
          keyExtractor={snapshotKey}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          emptyMessage={t('powershare.snapshot.noData', 'No Powershare signals received yet.')}
        />
      )}
    </GlassPanel>
  );
}
