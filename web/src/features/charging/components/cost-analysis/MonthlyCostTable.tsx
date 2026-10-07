import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import { DataTable, Text, type Column } from '@/components/ui';
import { Currency } from '@/components/data-display';

import { CostSection } from './CostSection';
import type { MonthlyBucket } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface MonthlyCostTableProps {
  data: MonthlyBucket[];
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function MonthlyCostTable({ data, isLoading, error, onRetry }: MonthlyCostTableProps) {
  const { fmtInt, fmtWithUnit, precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t } = useTranslation();
  const [tableSortKey, setTableSortKey] = useState('month');
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('desc');

  const columns = useMemo<Column<MonthlyBucket>[]>(
    () => [
      {
        key: 'month',
        header: t('costAnalysis.table.month', 'Month'),
        sortable: true,
        render: (row) => (
          <Text weight="medium" color="primary">{row.month}</Text>
        ),
      },
      {
        key: 'sessions',
        align: 'right',
        header: t('costAnalysis.table.sessions', 'Sessions'),
        sortable: true,
        render: (row) => fmtInt(row.sessions),
      },
      {
        key: 'energy',
        align: 'right',
        header: t('costAnalysis.table.energy', 'Energy'),
        sortable: true,
        render: (row) => fmtWithUnit(row.energy, 'kWh'),
      },
      {
        key: 'cost',
        align: 'right',
        header: t('costAnalysis.table.cost', 'Cost'),
        sortable: true,
        render: (row) => (
          <Currency value={row.cost} className="text-cyan-300" />
        ),
      },
      {
        key: 'avgCostPerKwh',
        align: 'right',
        header: t('costAnalysis.table.avgRate', 'Avg $/kWh'),
        sortable: true,
        render: (row) => <Currency value={row.avgCostPerKwh} precision={displayPrecision} />,
      },
      {
        key: 'gasEquiv',
        align: 'right',
        header: t('costAnalysis.table.gasEquiv', 'Gas equiv'),
        sortable: true,
        render: (row) => (
          <Currency value={row.gasEquiv} className="text-rose-300" />
        ),
      },
      {
        key: 'savings',
        align: 'right',
        header: t('costAnalysis.table.savings', 'Savings'),
        sortable: true,
        render: (row) => (
          <Text
            weight="medium"
            className={row.savings >= 0 ? 'text-emerald-300' : 'text-rose-300'}
          >
            {row.savings >= 0 ? '+' : ''}<Currency value={row.savings} />
          </Text>
        ),
      },
    ],
    [t, fmtInt, fmtWithUnit, displayPrecision, displayLocale],
  );

  const sortedData = useMemo(() => {
    const rows = data ?? [];
    if (rows.length === 0) return [];
    return [...rows].sort((a, b) => {
      const aVal = a[tableSortKey as keyof MonthlyBucket];
      const bVal = b[tableSortKey as keyof MonthlyBucket];
      const cmp =
        typeof aVal === 'number' && typeof bVal === 'number'
          ? aVal - bVal
          : String(aVal ?? '').localeCompare(String(bVal ?? ''));
      return tableSortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, tableSortKey, tableSortDir]);

  const handleSort = (key: string) => {
    if (key === tableSortKey) {
      setTableSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setTableSortKey(key);
      setTableSortDir('desc');
    }
  };

  return (
    <CostSection
      title={t('costAnalysis.table.title', 'Monthly cost breakdown')}
      icon={<BarChart3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      isEmpty={sortedData.length === 0}
      emptyMessage={t('costAnalysis.table.noData', 'No monthly data available')}
      skeletonHeight={200}
    >
      <DataTable<MonthlyBucket>
        tableId="charging:cost-monthly"
        columns={columns}
        mobileColumns={['month', 'cost', 'savings']}
        data={sortedData}
        keyExtractor={(row) => row.month}
        sortKey={tableSortKey}
        sortDir={tableSortDir}
        onSort={handleSort}
        compact
        pagination
        columnVisibility
        columnReorder
      />
    </CostSection>
  );
}
