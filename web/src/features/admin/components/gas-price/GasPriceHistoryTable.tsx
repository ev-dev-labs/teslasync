import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import { History } from 'lucide-react';

import { GlassPanel, PanelTitle, Text, Badge, DataTable, useSortToggle, type Column } from '@/components/ui';
import { Skeleton, QueryError } from '@/components/feedback';
import { useFormatting } from '@/hooks/useFormatting';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type { GasPriceHistory } from '@/api/types';

interface GasPriceHistoryTableProps {
  query: UseQueryResult<GasPriceHistory[], Error>;
}

/**
 * Full-width detail band — the raw EIA price-history records backing the trend
 * chart. Doubles as the non-visual, accessible fallback for the chart above.
 */
export function GasPriceHistoryTable({ query }: GasPriceHistoryTableProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const { sortKey, sortDir, onSort } = useSortToggle('effective_from', 'desc');

  const { data, isLoading, isError, error, refetch } = query;
  const rows = data ?? [];

  // The columns advertise themselves as sortable, so the parent MUST own the
  // sort state and hand a pre-sorted array back to <DataTable> — the table
  // itself is presentational and only fires `onSort`, it never reorders rows.
  // Sorting a defensive copy keeps the query's cached array immutable, and
  // every accessor is null-guarded so one malformed record can't scramble the
  // whole view.
  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'effective_from': {
          const ta = Date.parse(a.effective_from);
          const tb = Date.parse(b.effective_from);
          return ((Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb)) * dir;
        }
        case 'price_per_unit':
          return ((a.price_per_unit ?? 0) - (b.price_per_unit ?? 0)) * dir;
        case 'unit':
          return (a.unit ?? '').localeCompare(b.unit ?? '') * dir;
        case 'efficiency_mpg':
          return ((a.efficiency_mpg ?? 0) - (b.efficiency_mpg ?? 0)) * dir;
        default:
          return 0;
      }
    });
  }, [rows, sortKey, sortDir]);

  const columns = useMemo<Column<GasPriceHistory>[]>(
    () => [
      {
        key: 'effective_from',
        header: t('gas.effectiveFrom', 'Effective From'),
        sortable: true,
        render: (r) => (
          <Text variant="body">{formatDateTime(r.effective_from)}</Text>
        ),
      },
      {
        key: 'price_per_unit',
        header: t('gas.price', 'Price'),
        sortable: true,
        render: (r) => (
          <Text variant="body" className="tabular-nums">
            {formatCurrency(r.price_per_unit ?? 0)}
            <Text color="muted">/{r.unit ?? '—'}</Text>
          </Text>
        ),
      },
      {
        key: 'unit',
        header: t('gas.unit', 'Unit'),
        sortable: true,
        render: (r) => (
          <Badge variant="neutral" size="sm">
            {r.unit ?? '—'}
          </Badge>
        ),
      },
      {
        key: 'efficiency_mpg',
        header: t('gas.efficiency', 'Efficiency'),
        sortable: true,
        render: (r) => (
          <Text size="sm" color="secondary" className="tabular-nums">
            {r.efficiency_mpg ? `${fmtNumber(r.efficiency_mpg, 0)} ${t('gas.mpg', 'mpg')}` : '—'}
          </Text>
        ),
      },
      {
        key: 'effective_to',
        header: t('gas.effectiveTo', 'Effective To'),
        sortable: false,
        render: (r) =>
          r.effective_to ? (
            <Text size="sm" color="secondary">{formatDateTime(r.effective_to)}</Text>
          ) : (
            <Badge variant="success" size="sm">
              {t('gas.current', 'Current')}
            </Badge>
          ),
      },
    ],
    [t, formatCurrency],
  );

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <History className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('gas.historyTitle', 'Price History')}
      </PanelTitle>

      {isError ? (
        <QueryError
          error={error}
          onRetry={() => void refetch()}
          resourceName={t('gas.title', 'Gas Price Auto-Poll')}
        />
      ) : isLoading && rows.length === 0 ? (
        <Skeleton height={240} className="rounded-xl" />
      ) : (
        <DataTable
          tableId="admin:gas-price-history"
          columns={columns}
          data={sortedRows}
          keyExtractor={(r) => r.id}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          emptyMessage={t('gas.noHistoryRows', 'No price history recorded yet.')}
          pagination
        />
      )}
    </GlassPanel>
  );
}
