import { useTranslation } from 'react-i18next';
import { ArrowUpDown, Filter, Wrench } from 'lucide-react';
import type { DataState } from '@/api/dataState';
import { LayoutCard } from '@/components/layout';
import { EmptyState, Skeleton } from '@/components/feedback';
import { Select } from '@/components/ui';
import { MaintenanceSource } from './MaintenanceSource';
import { MaintenanceItemCard } from './MaintenanceItemCard';
import type { DistanceFormatter, MaintenanceItem } from './maintenanceModel';

export interface MaintenanceItemsPanelProps {
  source: DataState<MaintenanceItem[]>;
  enabled: boolean;
  items: readonly MaintenanceItem[];
  categoryFilter: string;
  sortBy: string;
  categoryOptions: { value: string; label: string }[];
  sortOptions: { value: string; label: string }[];
  onCategoryChange: (value: string) => void;
  onSortChange: (value: string) => void;
  formatDistance: DistanceFormatter;
}

export function MaintenanceItemsPanel({
  source, enabled, items, categoryFilter, sortBy, categoryOptions, sortOptions,
  onCategoryChange, onSortChange, formatDistance,
}: MaintenanceItemsPanelProps) {
  const { t } = useTranslation();
  const empty = (
    <EmptyState
      icon={<Wrench className="h-12 w-12" />}
      title={t('maintenance.noItemsTitle', 'No maintenance items')}
      message={categoryFilter !== 'all'
        ? t('maintenance.noItemsFiltered', 'No items match the selected category. Try a different filter.')
        : t('maintenance.noItems', 'No maintenance items found for this vehicle.')}
      action={categoryFilter !== 'all'
        ? { label: t('maintenance.clearFilterCta', 'Clear filter'), onClick: () => onCategoryChange('all') }
        : undefined}
    />
  );
  return (
    <LayoutCard
      title={t('maintenance.itemsTitle', 'Maintenance items')}
      actions={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          <Select
            size="sm"
            aria-label={t('maintenance.filterCategory', 'Filter by category')}
            value={categoryFilter}
            onChange={event => onCategoryChange(event.target.value)}
            options={categoryOptions}
          />
          <ArrowUpDown className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          <Select
            size="sm"
            aria-label={t('maintenance.sortBy', 'Sort items')}
            value={sortBy}
            onChange={event => onSortChange(event.target.value)}
            options={sortOptions}
          />
        </div>
      }
    >
      <MaintenanceSource
        source={source}
        enabled={enabled}
        empty={empty}
        loading={
          <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2">
            {[0, 1, 2, 3, 4, 5].map(key => <Skeleton key={key} className="h-44 rounded-xl" />)}
          </div>
        }
      >
        {items.length === 0 ? empty : (
          <div className="grid grid-cols-1 gap-x-5 @lg:grid-cols-2">
            {items.map(item => (
              <MaintenanceItemCard key={item.id} item={item} formatDistance={formatDistance} />
            ))}
          </div>
        )}
      </MaintenanceSource>
    </LayoutCard>
  );
}
