import { useMemo } from 'react';
import { FilterX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  RepairCaseFilters,
  RepairCaseStatus,
  RepairConfidence,
  RepairSessionKind,
} from '@/api/hooks/useDataRepair';
import { SearchInput } from '@/components/forms';
import { Button, Select } from '@/components/ui';

interface RepairCaseFiltersBarProps {
  filters: RepairCaseFilters;
  onChange: (filters: RepairCaseFilters) => void;
}

export function RepairCaseFiltersBar({ filters, onChange }: RepairCaseFiltersBarProps) {
  const { t } = useTranslation();
  const setFilter = <K extends keyof RepairCaseFilters>(key: K, value: RepairCaseFilters[K]) => {
    onChange({ ...filters, [key]: value, cursor_id: undefined, cursor_last_seen_at: undefined });
  };
  const hasFilters = Boolean(filters.status || filters.kind || filters.confidence || filters.assigned_to);
  const statusOptions = useMemo(() => [
    { value: '', label: t('dataRepair.cases.filters.allStatuses', 'All statuses') },
    { value: 'open', label: t('dataRepair.cases.status.open', 'Open') },
    { value: 'in_review', label: t('dataRepair.cases.status.inReview', 'In review') },
    { value: 'quarantined', label: t('dataRepair.cases.status.quarantined', 'Quarantined') },
    { value: 'applied', label: t('dataRepair.cases.status.applied', 'Applied') },
    { value: 'resolved', label: t('dataRepair.cases.status.resolved', 'Resolved') },
    { value: 'dismissed', label: t('dataRepair.cases.status.dismissed', 'Dismissed') },
    { value: 'restored', label: t('dataRepair.cases.status.restored', 'Restored') },
  ], [t]);
  const kindOptions = useMemo(() => [
    { value: '', label: t('dataRepair.cases.filters.allKinds', 'All session types') },
    { value: 'drive', label: t('dataRepair.kind.drive', 'Drive') },
    { value: 'charging', label: t('dataRepair.kind.charging', 'Charging') },
  ], [t]);
  const confidenceOptions = useMemo(() => [
    { value: '', label: t('dataRepair.cases.filters.allConfidence', 'All confidence levels') },
    { value: 'high', label: t('dataRepair.confidence.high', 'High confidence') },
    { value: 'medium', label: t('dataRepair.confidence.medium', 'Medium confidence') },
  ], [t]);

  return (
    <div className="flex w-full flex-col gap-2 xl:w-auto">
      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-4">
        <Select
          aria-label={t('dataRepair.cases.filters.status', 'Filter by status')}
          options={statusOptions}
          value={filters.status ?? ''}
          onChange={(event) => setFilter(
            'status',
            (event.target.value || undefined) as RepairCaseStatus | undefined,
          )}
        />
        <Select
          aria-label={t('dataRepair.cases.filters.kind', 'Filter by session type')}
          options={kindOptions}
          value={filters.kind ?? ''}
          onChange={(event) => setFilter(
            'kind',
            (event.target.value || undefined) as RepairSessionKind | undefined,
          )}
        />
        <Select
          aria-label={t('dataRepair.cases.filters.confidence', 'Filter by confidence')}
          options={confidenceOptions}
          value={filters.confidence ?? ''}
          onChange={(event) => setFilter(
            'confidence',
            (event.target.value || undefined) as RepairConfidence | undefined,
          )}
        />
        <SearchInput
          ariaLabel={t('dataRepair.cases.filters.owner', 'Filter by owner')}
          placeholder={t('dataRepair.cases.filters.ownerPlaceholder', 'Owner')}
          value={filters.assigned_to ?? ''}
          onChange={(value) => setFilter('assigned_to', value || undefined)}
          debounceMs={300}
        />
      </div>
      {hasFilters ? (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            icon={<FilterX className="h-4 w-4" aria-hidden="true" />}
            onClick={() => onChange({ vehicle_id: filters.vehicle_id, limit: filters.limit })}
          >
            {t('dataRepair.cases.filters.clear', 'Clear filters')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
