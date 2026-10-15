import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
import { Button, DataTable, Text, type Column } from '@/components/ui';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import type { DataState } from '@/api/dataState';
import { formatDateTime } from '@/lib/dateFormat';
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
  const { vehicleId } = useSelectedVehicle();
  const enabled = vehicleId !== null;
  const unresolved = !source.hasData && !source.fatalError;
  return (
    <LayoutCard title={t('tirePressure.historyTable', 'History table')}>
      <PressureRefreshNotice source={source} label={t('dataSources.labels.tirePressureHistory', 'Tire pressure history')} />
      {enabled && loading && !source.hasData && !source.isRefreshBlocked ? <Skeleton height={220} className="w-full" />
        : source.fatalError ? <QueryError error={source.fatalError} onRetry={source.retry ?? undefined}
          resourceName={t('tirePressure.resource', 'Tire pressure')} />
        : unresolved ? <div className="space-y-3">
          <Text as="p" variant="bodySm" role="status">
            {!enabled ? t('common.noVehicleSelected.title', 'No vehicle selected')
              : source.isRefreshBlocked ? t('dataSources.status.paused', 'Refresh paused')
                : t('developerReference.layout.source.loading', 'Loading {{label}}', {
                  label: t('dataSources.labels.tirePressureHistory', 'Tire pressure history'),
                })}
          </Text>
          {enabled && source.retry && <Button variant="secondary" size="sm" onClick={source.retry}>
            {t('error.retry', 'Retry')}
          </Button>}
        </div>
        : !rows.length ? <EmptyState icon={<Clock className="h-8 w-8" aria-hidden="true" />}
          message={t('tirePressure.noHistory', 'No history data')}
          action={source.retry ? { label: t('common.refresh', 'Refresh'), onClick: source.retry } : undefined} />
        : <DataTable
          variant="embedded"
          tableId="vehicle-systems:tire-pressure-history"
          enableValueFilters
          columns={columns}
          mobilePresentation={{
            roles: { created_at: 'title' },
            displayValue: (row, key) => key === 'created_at' ? formatDateTime(row.created_at) : null,
          }}
          caption={t('tirePressure.historyTable', 'History table')}
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
