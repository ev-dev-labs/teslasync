import { useTranslation } from 'react-i18next';
import { Wrench } from 'lucide-react';
import type { DataState } from '@/api/dataState';
import { LayoutCard } from '@/components/layout';
import { EmptyState, Skeleton } from '@/components/feedback';
import { DataTable, type Column } from '@/components/ui';
import type { ServiceRecord } from './maintenanceModel';
import { MaintenanceSource } from './MaintenanceSource';

/** The table retains its embedded pipeline and stable preference identity. */
export function MaintenanceRecordsPanel({
  source,
  enabled,
  records,
  columns,
}: {
  source: DataState<ServiceRecord[]>;
  enabled: boolean;
  records: ServiceRecord[];
  columns: Column<ServiceRecord>[];
}) {
  const { t } = useTranslation();
  const empty = (
    <EmptyState icon={<Wrench className="h-10 w-10" />} message={t('maintenance.noRecords', 'No service records logged yet.')}
      action={enabled && source.retry ? { label: t('common.refresh', 'Refresh'), onClick: source.retry } : undefined}
      actionTo={!enabled ? { label: t('nav.manageVehicles', 'Manage vehicles'), to: '/vehicles' } : undefined} />
  );
  return (
    <LayoutCard title={t('maintenance.recordsTitle', 'Service records')}>
      <MaintenanceSource
        source={source}
        enabled={enabled}
        empty={empty}
        loading={<div className="space-y-3">{[0, 1, 2].map(key => <Skeleton key={key} className="h-12 rounded-lg" />)}</div>}
      >
        {records.length === 0 ? empty : (
          <DataTable<ServiceRecord>
            tableId="vehicle-systems:maintenance-records"
            variant="embedded"
            enableValueFilters
            columns={columns}
            data={records}
            keyExtractor={record => record.id}
            compact
            pagination
            emptyMessage={t('maintenance.noRecordsShort', 'No service records found.')}
          />
        )}
      </MaintenanceSource>
    </LayoutCard>
  );
}
