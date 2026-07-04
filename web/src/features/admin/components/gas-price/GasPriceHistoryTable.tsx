import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import { History } from 'lucide-react';

import { GlassPanel, PanelTitle, Text, Badge, DataTable, type Column } from '@/components/ui';
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

  const { data, isLoading, isError, error, refetch } = query;
  const rows = data ?? [];

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
          data={rows}
          keyExtractor={(r) => r.id}
          emptyMessage={t('gas.noHistoryRows', 'No price history recorded yet.')}
          pagination
        />
      )}
    </GlassPanel>
  );
}
