import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
import { DataTable, type Column } from '@/components/ui';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import type { DataState } from '@/api/dataState';
import type { TirePressureReading } from '../../pages/TirePressurePage';
import { PressureRefreshNotice } from './PressureRefreshNotice';

export interface PressureHistoryTableProps {
  source: DataState<TirePressureReading[]>;
  loading: boolean;
  rows: TirePressureReading[];
  columns: Column<TirePressureReading>[];
  sortKey: string;
  sortDir: 'asc' | 'desc';
  onSort: (key: string) => void;
}

export function PressureHistoryTable({ source, loading, rows, columns, sortKey, sortDir, onSort }: PressureHistoryTableProps) {
  const { t } = useTranslation();
  return (
    <LayoutCard title={t('tirePressure.historyTable', 'History table')}>
      <PressureRefreshNotice source={source} label={t('dataSources.labels.tirePressureHistory', 'Tire pressure history')} />
      {loading && !source.hasData ? <Skeleton height={220} className="w-full" />
        : source.fatalError ? <QueryError error={source.fatalError} onRetry={source.retry ?? undefined}
          resourceName={t('tirePressure.resource', 'Tire pressure')} />
        : !rows.length ? <EmptyState icon={<Clock className="h-8 w-8" aria-hidden="true" />}
          message={t('tirePressure.noHistory', 'No history data')}
          action={source.retry ? { label: t('common.refresh', 'Refresh'), onClick: source.retry } : undefined} />
        : <DataTable
          variant="embedded"
          tableId="vehicle-systems:tire-pressure-history"
          enableValueFilters
          columns={columns}
          mobileColumns={['created_at', 'warnings']}
          data={rows}
          keyExtractor={row => row.id}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          emptyMessage={t('tirePressure.noHistory', 'No history data')}
          compact
          pagination
        />}
    </LayoutCard>
  );
}
