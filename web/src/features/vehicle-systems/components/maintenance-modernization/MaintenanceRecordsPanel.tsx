import { useTranslation } from 'react-i18next';
import { Wrench } from 'lucide-react';
import type { DataState } from '@/api/dataState';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { EmptyState, Skeleton } from '@/components/feedback';
import { DataTable, GlassPanel, PanelTitle, type Column } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { ServiceRecord } from './maintenanceModel';
import { MaintenanceSource } from './MaintenanceSource';

/** Preserve the inherited direct heading/panel relationship for consumers.
 * The canonical provider owns placement; this existing surface adds no second
 * packer, observer, nested table card or header chrome. */
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
  const placement = useCardPlacement();
  const empty = (
    <EmptyState icon={<Wrench className="h-10 w-10" />} message={t('maintenance.noRecords', 'No service records logged yet.')} />
  );
  return (
    <GlassPanel className={cn('h-full min-w-0 p-3', placement && placement.width >= 640 && 'p-4')}>
      <PanelTitle className="mb-3">{t('maintenance.recordsTitle', 'Service records')}</PanelTitle>
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
    </GlassPanel>
  );
}
