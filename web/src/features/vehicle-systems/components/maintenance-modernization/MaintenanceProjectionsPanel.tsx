import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { LayoutCard } from '@/components/layout/layout-reference';
import { EmptyState, Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import type { DistanceFormatter, MaintenanceItem, ServiceProjection } from './maintenanceModel';
import { MaintenanceSource } from './MaintenanceSource';
import { MaintenanceStatusBadge } from './MaintenanceStatusBadge';

export function MaintenanceProjectionsPanel({
  source, enabled, projections, formatDistance,
}: {
  source: DataState<MaintenanceItem[]>;
  enabled: boolean;
  projections: readonly ServiceProjection[];
  formatDistance: DistanceFormatter;
}) {
  const { t } = useTranslation();
  const empty = <EmptyState message={t('maintenance.noProjections', 'No upcoming service projections available.')} />;
  return (
    <LayoutCard title={t('maintenance.projectionsTitle', 'Service projections')}>
      <MaintenanceSource
        source={source}
        enabled={enabled}
        empty={empty}
        loading={<div className="space-y-3">{[0, 1, 2, 3, 4].map(key => <Skeleton key={key} className="h-8 rounded-lg" />)}</div>}
      >
        {projections.length === 0 ? empty : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {projections.map(projection => (
              <li key={projection.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <Text as="span" variant="bodySm" className="block break-words">{projection.name}</Text>
                  <Text as="span" variant="caption">{projection.category}</Text>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {projection.metersRemaining != null && (
                    <Text as="span" variant="caption" className="tabular-nums">
                      {formatDistance(projection.metersRemaining)}
                    </Text>
                  )}
                  {projection.dueDate && <Text as="span" variant="caption">{projection.dueDate}</Text>}
                  <MaintenanceStatusBadge status={projection.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </MaintenanceSource>
    </LayoutCard>
  );
}
