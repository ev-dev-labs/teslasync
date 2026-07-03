import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ListTree } from 'lucide-react';

import { GlassPanel, PanelTitle, Caption, DataTable, type Column } from '@/components/ui';
import { Skeleton, QueryError } from '@/components/feedback';
import { DateTime } from '@/components/data-display';

import type { SnapshotRow } from './constants';

interface SignalSnapshotPanelProps {
  rows: SnapshotRow[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/** Full-width detail band — the latest raw value + timestamp for every
 *  Powershare signal feeding this page. */
export function SignalSnapshotPanel({ rows, isLoading, error, onRetry }: SignalSnapshotPanelProps) {
  const { t } = useTranslation();

  const columns = useMemo<Column<SnapshotRow>[]>(
    () => [
      {
        key: 'label',
        header: t('powershare.snapshot.signal', 'Signal'),
        sortable: true,
        render: (row) => (
          <span className="text-sm text-[var(--text-secondary)]">{row.label}</span>
        ),
      },
      {
        key: 'value',
        header: t('powershare.snapshot.value', 'Value'),
        sortable: true,
        render: (row) => (
          <span className="text-sm font-medium tabular-nums text-[var(--text-primary)]">
            {row.value}
          </span>
        ),
      },
      {
        key: 'ts',
        header: t('powershare.snapshot.updated', 'Updated'),
        sortable: true,
        render: (row) =>
          row.ts ? (
            <DateTime value={row.ts} variant="relative" className="text-xs text-[var(--text-muted)]" />
          ) : (
            <span className="text-xs text-[var(--text-muted)]">—</span>
          ),
      },
    ],
    [t],
  );

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
          data={rows}
          keyExtractor={(row) => row.key}
          emptyMessage={t('powershare.snapshot.noData', 'No Powershare signals received yet.')}
        />
      )}
    </GlassPanel>
  );
}
