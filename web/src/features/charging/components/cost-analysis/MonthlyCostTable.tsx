import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import { GlassPanel, DataTable, type Column } from '@/components/ui';
import { fmtNumber, fmtInt, fmtWithUnit } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { MonthlyBucket } from './types';

interface MonthlyCostTableProps {
  data: MonthlyBucket[];
}

export function MonthlyCostTable({ data }: MonthlyCostTableProps) {
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
          <span className="font-medium text-white">{row.month}</span>
        ),
      },
      {
        key: 'sessions',
        header: t('costAnalysis.table.sessions', 'Sessions'),
        sortable: true,
        render: (row) => fmtInt(row.sessions),
      },
      {
        key: 'energy',
        header: t('costAnalysis.table.energy', 'Energy'),
        sortable: true,
        render: (row) => fmtWithUnit(row.energy, 'kWh', 1),
      },
      {
        key: 'cost',
        header: t('costAnalysis.table.cost', 'Cost'),
        sortable: true,
        render: (row) => (
          <span className="text-cyan-400">${fmtNumber(row.cost, 2)}</span>
        ),
      },
      {
        key: 'avgCostPerKwh',
        header: t('costAnalysis.table.avgRate', 'Avg $/kWh'),
        sortable: true,
        render: (row) => `$${fmtNumber(row.avgCostPerKwh, 3)}`,
      },
      {
        key: 'gasEquiv',
        header: t('costAnalysis.table.gasEquiv', 'Gas Equiv'),
        sortable: true,
        render: (row) => (
          <span className="text-red-400">${fmtNumber(row.gasEquiv, 2)}</span>
        ),
      },
      {
        key: 'savings',
        header: t('costAnalysis.table.savings', 'Savings'),
        sortable: true,
        render: (row) => (
          <span
            className={cn(
              'font-medium',
              row.savings >= 0 ? 'text-green-400' : 'text-red-400',
            )}
          >
            {row.savings >= 0 ? '+' : ''}${fmtNumber(row.savings, 2)}
          </span>
        ),
      },
    ],
    [t],
  );

  const sortedData = useMemo(() => {
    if (data.length === 0) return [];
    return [...data].sort((a, b) => {
      const aVal = a[tableSortKey as keyof MonthlyBucket];
      const bVal = b[tableSortKey as keyof MonthlyBucket];
      const cmp =
        typeof aVal === 'number' && typeof bVal === 'number'
          ? aVal - bVal
          : String(aVal).localeCompare(String(bVal));
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
    <GlassPanel className="p-4">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
        <BarChart3 className="h-4 w-4 text-cyan-400" />
        {t('costAnalysis.table.title', 'Monthly Cost Breakdown')}
      </h3>
      {sortedData.length > 0 ? (
        <DataTable<MonthlyBucket>
          columns={columns}
          data={sortedData}
          keyExtractor={(row) => row.month}
          sortKey={tableSortKey}
          sortDir={tableSortDir}
          onSort={handleSort}
          compact
          pagination
        />
      ) : (
        <div className="flex h-32 items-center justify-center text-sm text-gray-500">
          {t('costAnalysis.table.noData', 'No monthly data available')}
        </div>
      )}
    </GlassPanel>
  );
}
