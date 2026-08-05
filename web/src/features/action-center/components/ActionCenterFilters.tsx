import { useTranslation } from 'react-i18next';
import { Button, GlassPanel, PanelTitle, Select } from '@/components/ui';
import type {
  ActionCenterFilter,
  ActionCenterPriority,
  ActionCenterSourceFeature,
  ActionCenterState,
} from '@/types/actionCenter';

interface FilterVehicle {
  id: number;
  display_name: string;
}

interface ActionCenterFiltersProps {
  filter: ActionCenterFilter;
  vehicles: FilterVehicle[];
  onChange: (filter: ActionCenterFilter) => void;
}

export function ActionCenterFilters({ filter, vehicles, onChange }: ActionCenterFiltersProps) {
  const { t } = useTranslation();
  const vehicleOptions = [
    { value: '', label: t('actionCenter.filters.allVehicles', 'All vehicles') },
    ...vehicles.map((vehicle) => ({ value: String(vehicle.id), label: vehicle.display_name })),
  ];
  const priorityOptions = [
    { value: '', label: t('actionCenter.filters.allPriorities', 'All priorities') },
    { value: 'critical', label: t('actionCenter.priority.critical', 'Critical') },
    { value: 'high', label: t('actionCenter.priority.high', 'High') },
    { value: 'medium', label: t('actionCenter.priority.medium', 'Medium') },
    { value: 'low', label: t('actionCenter.priority.low', 'Low') },
  ];
  const sourceOptions = [
    { value: '', label: t('actionCenter.filters.allSources', 'All sources') },
    { value: 'active_alerts', label: t('actionCenter.source.active_alerts', 'Active alerts') },
    {
      value: 'charging_reliability',
      label: t('actionCenter.source.charging_reliability', 'Charging reliability'),
    },
    {
      value: 'fleet_maintenance',
      label: t('actionCenter.source.fleet_maintenance', 'Fleet maintenance'),
    },
    { value: 'signal_health', label: t('actionCenter.source.signal_health', 'Signal health') },
  ];
  const stateOptions = [
    { value: '', label: t('actionCenter.filters.allStates', 'All states') },
    { value: 'open', label: t('actionCenter.state.open', 'Open') },
    { value: 'acknowledged', label: t('actionCenter.state.acknowledged', 'Acknowledged') },
    { value: 'snoozed', label: t('actionCenter.state.snoozed', 'Snoozed') },
    { value: 'dismissed', label: t('actionCenter.state.dismissed', 'Dismissed') },
  ];
  const clear = () => onChange({ state: 'open', limit: filter.limit ?? 50, offset: 0 });

  return (
    <GlassPanel padding="md">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PanelTitle>{t('actionCenter.filters.title', 'Filter decisions')}</PanelTitle>
        <Button type="button" variant="ghost" size="sm" onClick={clear}>
          {t('actionCenter.filters.clear', 'Clear filters')}
        </Button>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Select
          label={t('actionCenter.filters.vehicle', 'Vehicle')}
          options={vehicleOptions}
          value={filter.vehicle_id ?? ''}
          onChange={(event) =>
            onChange({
              ...filter,
              vehicle_id: event.target.value ? Number(event.target.value) : undefined,
              offset: 0,
            })
          }
        />
        <Select
          label={t('actionCenter.filters.priority', 'Priority')}
          options={priorityOptions}
          value={filter.priority ?? ''}
          onChange={(event) =>
            onChange({
              ...filter,
              priority: (event.target.value || undefined) as ActionCenterPriority | undefined,
              offset: 0,
            })
          }
        />
        <Select
          label={t('actionCenter.filters.source', 'Source')}
          options={sourceOptions}
          value={filter.source_feature ?? ''}
          onChange={(event) =>
            onChange({
              ...filter,
              source_feature: (event.target.value || undefined) as
                | ActionCenterSourceFeature
                | undefined,
              offset: 0,
            })
          }
        />
        <Select
          label={t('actionCenter.filters.state', 'State')}
          options={stateOptions}
          value={filter.state ?? ''}
          onChange={(event) =>
            onChange({
              ...filter,
              state: (event.target.value || undefined) as ActionCenterState | undefined,
              offset: 0,
            })
          }
        />
      </div>
    </GlassPanel>
  );
}
