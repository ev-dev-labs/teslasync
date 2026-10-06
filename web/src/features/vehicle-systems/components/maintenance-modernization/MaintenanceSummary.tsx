import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';
import { summarizeItems, type MaintenanceItem } from './maintenanceModel';

/** Snapshot counts have no analysis/lifetime completeness assertion.
 * Missing source != an authoritative empty array containing zero items. */
export function MaintenanceSummary({
  source,
  enabled,
}: {
  source: DataState<MaintenanceItem[]>;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  const summary = source.data != null ? summarizeItems(source.data) : null;
  const categories = source.data != null ? new Set(source.data.map(item => item.category)).size : null;
  const metrics = [
    { key: 'total', label: t('maintenance.kpi.total', 'Total items'), value: summary?.total ?? null },
    { key: 'overdue', label: t('maintenance.kpi.overdue', 'Overdue'), value: summary?.overdue ?? null },
    { key: 'soon', label: t('maintenance.kpi.soon', 'Due soon'), value: summary?.soon ?? null },
    { key: 'healthy', label: t('maintenance.kpi.healthy', 'Healthy'), value: summary?.good ?? null },
    { key: 'completed', label: t('maintenance.kpi.completed', 'Completed'), value: summary?.completed ?? null },
    { key: 'categories', label: t('maintenance.kpi.categories', 'Categories'), value: categories },
  ];
  return (
    <div className="w-full min-w-0">
        <VehicleOperationalBrief
          id="maintenance-summary"
          title={t('maintenance.kpis', 'Maintenance summary')}
          available={enabled && source.hasData}
          loading={!source.hasData && !source.fatalError && enabled && !source.isRefreshBlocked}
          period={{
            kind: 'snapshot',
            label: t('dataSources.labels.maintenanceItems', 'Maintenance items'),
            observedAt: source.updatedAt != null ? new Date(source.updatedAt).toISOString() : null,
            provenance: t('maintenance.summary.provenance', 'Counts use all returned maintenance items, before category filtering.'),
          }}
          retained={source.hasData && (source.status === 'stale' || source.isRefreshBlocked || source.refreshError != null)}
          error={source.fatalError?.message ?? source.refreshError?.message ?? null}
          metrics={metrics.map(metric => ({
            metricId: 'count' as const,
            occurrenceId: `maintenance-${metric.key}`,
            rawValue: enabled ? metric.value : null,
            label: metric.label,
            description: metric.label,
          }))}
        />
    </div>
  );
}
