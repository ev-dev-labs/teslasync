import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import type { GasPriceHistory } from '@/api/types';
import { LayoutCard } from '@/components/layout';
import { Badge, Text, DataTable, useSortToggle, type Column } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { useFormatting } from '@/hooks/useFormatting';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { formatDateTime } from '@/lib/dateFormat';
import { AdminSourceContent } from './AdminSourceContent';

export function GasHistoryTable({ source }: { source: DataState<GasPriceHistory[]> }) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const { fmtNumber } = useNumberFormatting();
  const { sortKey, sortDir, onSort } = useSortToggle('effective_from', 'desc');
  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...(source.data ?? [])].sort((a, b) => {
      switch (sortKey) {
        case 'effective_from': {
          const left = Date.parse(a.effective_from);
          const right = Date.parse(b.effective_from);
          return ((Number.isNaN(left) ? 0 : left) - (Number.isNaN(right) ? 0 : right)) * dir;
        }
        case 'price_per_unit': return ((a.price_per_unit ?? 0) - (b.price_per_unit ?? 0)) * dir;
        case 'unit': return (a.unit ?? '').localeCompare(b.unit ?? '') * dir;
        case 'efficiency_mpg': return ((a.efficiency_mpg ?? 0) - (b.efficiency_mpg ?? 0)) * dir;
        default: return 0;
      }
    });
  }, [source.data, sortKey, sortDir]);
  const columns = useMemo<Column<GasPriceHistory>[]>(() => [
    { key: 'effective_from', header: t('gas.effectiveFrom', 'Effective from'), sortable: true,
      filterValue: (r) => r.effective_from ?? null, filterValueLabel: (_value, r) => formatDateTime(r.effective_from),
      render: (r) => <Text>{formatDateTime(r.effective_from)}</Text> },
    { key: 'price_per_unit', header: t('gas.price', 'Price'), sortable: true, align: 'right',
      filterValue: (r) => r.price_per_unit ?? null,
      filterValueLabel: (_value, r) => r.price_per_unit == null ? '—' : `${formatCurrency(r.price_per_unit)}/${r.unit ?? '—'}`,
      render: (r) => <Text className="tabular-nums">{r.price_per_unit == null ? '—' : formatCurrency(r.price_per_unit)}<Text color="muted">/{r.unit ?? '—'}</Text></Text> },
    { key: 'unit', header: t('gas.unit', 'Unit'), sortable: true, filterValue: (r) => r.unit ?? null,
      render: (r) => <Badge variant="neutral" size="sm">{r.unit ?? '—'}</Badge> },
    { key: 'efficiency_mpg', header: t('gas.efficiency', 'Efficiency'), sortable: true, align: 'right',
      filterValue: (r) => r.efficiency_mpg ?? null,
      filterValueLabel: (_value, r) => r.efficiency_mpg == null ? '—' : `${fmtNumber(r.efficiency_mpg)} ${t('gas.mpg', 'mpg')}`,
      render: (r) => <Text size="sm" color="secondary" className="tabular-nums">{r.efficiency_mpg == null ? '—' : `${fmtNumber(r.efficiency_mpg)} ${t('gas.mpg', 'mpg')}`}</Text> },
    { key: 'effective_to', header: t('gas.effectiveTo', 'Effective to'), sortable: false,
      filterValue: (r) => r.effective_to ?? null,
      filterValueLabel: (_value, r) => r.effective_to ? formatDateTime(r.effective_to) : t('gas.current', 'Current'),
      render: (r) => r.effective_to ? <Text size="sm" color="secondary">{formatDateTime(r.effective_to)}</Text> : <Badge variant="success" size="sm">{t('gas.current', 'Current')}</Badge> },
  ], [t, formatCurrency, fmtNumber]);
  return (
    <LayoutCard title={t('gas.historyTitle', 'Price history')}>
      <AdminSourceContent source={source} label={t('gas.historyTitle', 'Price history')} emptyMessage={t('gas.noHistoryRows', 'No price history recorded yet.')} loadingContent={<Skeleton height={240} className="rounded-xl" />}>
        <DataTable tableId="admin:gas-price-history" columns={columns} mobileColumns={['effective_from', 'price_per_unit', 'effective_to']}
          data={sortedRows} enableValueFilters keyExtractor={(r) => r.id} sortKey={sortKey} sortDir={sortDir} onSort={onSort}
          emptyMessage={t('gas.noHistoryRows', 'No price history recorded yet.')} pagination />
      </AdminSourceContent>
    </LayoutCard>
  );
}
