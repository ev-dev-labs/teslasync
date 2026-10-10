import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { MetricBar } from '@/components/data-display';
import { LayoutCard } from '@/components/layout';
import { EmptyState, Skeleton } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { CategoryBreakdown, MaintenanceItem } from './maintenanceModel';
import { categoryColor } from './maintenancePresentation';
import { MaintenanceSource } from './MaintenanceSource';

export function MaintenanceCategoriesPanel({
  source,
  enabled,
  breakdown,
}: {
  source: DataState<MaintenanceItem[]>;
  enabled: boolean;
  breakdown: readonly CategoryBreakdown[];
}) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const empty = <EmptyState message={t('maintenance.noCategory', 'No maintenance items to categorize yet.')}
    action={enabled && source.retry ? { label: t('common.refresh', 'Refresh'), onClick: source.retry } : undefined}
    actionTo={!enabled ? { label: t('nav.manageVehicles', 'Manage vehicles'), to: '/vehicles' } : undefined} />;
  return (
    <LayoutCard title={t('maintenance.categoryTitle', 'Maintenance by category')}>
      <MaintenanceSource
        source={source}
        enabled={enabled}
        empty={empty}
        loading={<div className="space-y-3">{[0, 1, 2, 3].map(key => <Skeleton key={key} className="h-8 rounded-lg" />)}</div>}
      >
        {breakdown.length === 0 ? empty : (
          <div className="space-y-4">
            {breakdown.map(row => (
              <MetricBar
                key={row.category}
                label={row.category.charAt(0).toUpperCase() + row.category.slice(1)}
                value={row.count}
                max={row.max}
                color={categoryColor(row.category)}
                sublabel={`${fmtInt(row.count)} ${t('maintenance.items', 'items')}`}
              />
            ))}
          </div>
        )}
      </MaintenanceSource>
    </LayoutCard>
  );
}
