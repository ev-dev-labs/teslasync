import { useTranslation } from 'react-i18next';
import { CarFront } from 'lucide-react';
import { GlassPanel, PanelTitle, Caption, Text } from '@/components/ui';
import type {
  ServiceIntelligenceSummary,
  ServiceIntelligenceVehicleContext,
} from '@/api/hooks/useServiceIntelligence';
import { PanelState } from './PanelState';

export interface VehicleMatchPanelProps {
  selected: boolean;
  loading: boolean;
  error: unknown;
  context: ServiceIntelligenceVehicleContext | null;
  summary: ServiceIntelligenceSummary | null;
  onRetry: () => void;
}

function display(value: string | number | null, unavailable: string): string {
  return value == null || value === '' ? unavailable : String(value);
}

export function VehicleMatchPanel({
  selected,
  loading,
  error,
  context,
  summary,
  onRetry,
}: VehicleMatchPanelProps) {
  const { t } = useTranslation();
  const unavailable = t('serviceIntelligence.common.unavailable', 'Unavailable');
  const plant = context
    ? [context.plant_city, context.plant_state, context.plant_country].filter(Boolean).join(', ')
    : '';

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <CarFront className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('serviceIntelligence.vehicle.title', 'Vehicle match context')}
      </PanelTitle>
      <PanelState
        selected={selected}
        loading={loading}
        error={error}
        empty={context == null}
        icon={<CarFront className="h-9 w-9" />}
        selectTitle={t('serviceIntelligence.common.selectTitle', 'Select a vehicle')}
        selectMessage={t(
          'serviceIntelligence.common.selectMessage',
          'Choose a vehicle to compare its decoded build and firmware context with safety records.',
        )}
        emptyTitle={t('serviceIntelligence.vehicle.emptyTitle', 'No vehicle context')}
        emptyMessage={t(
          'serviceIntelligence.vehicle.empty',
          'Decoded build and firmware context is not available yet.',
        )}
        onRetry={onRetry}
      >
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div>
              <dt><Caption>{t('serviceIntelligence.vehicle.model', 'Vehicle')}</Caption></dt>
              <dd><Text variant="body">{context ? `${context.make} ${context.model}` : unavailable}</Text></dd>
            </div>
            <div>
              <dt><Caption>{t('serviceIntelligence.vehicle.modelYear', 'Model year')}</Caption></dt>
              <dd><Text variant="body">{display(context?.model_year ?? null, unavailable)}</Text></dd>
            </div>
            <div>
              <dt><Caption>{t('serviceIntelligence.vehicle.assemblyPlant', 'Assembly plant')}</Caption></dt>
              <dd><Text variant="body">{display(plant, unavailable)}</Text></dd>
            </div>
            <div>
              <dt><Caption>{t('serviceIntelligence.vehicle.firmware', 'Observed firmware')}</Caption></dt>
              <dd><Text variant="body" mono>{display(context?.firmware_version ?? null, unavailable)}</Text></dd>
            </div>
          </dl>
          <Text as="p" variant="helper">{context?.build_match_basis ?? unavailable}</Text>
          <dl className="grid grid-cols-2 gap-3 border-t border-[var(--border-subtle)] pt-3 lg:grid-cols-4">
            <div>
              <dt><Caption>{t('serviceIntelligence.summary.recallCandidates', 'Recall candidates')}</Caption></dt>
              <dd><Text variant="metricValue">{summary?.recall_candidates ?? 0}</Text></dd>
            </div>
            <div>
              <dt><Caption>{t('serviceIntelligence.summary.applicable', 'Potentially applicable')}</Caption></dt>
              <dd><Text variant="metricValue">{summary?.potentially_applicable_recalls ?? 0}</Text></dd>
            </div>
            <div>
              <dt><Caption>{t('serviceIntelligence.summary.communications', 'Communications')}</Caption></dt>
              <dd><Text variant="metricValue">{summary?.manufacturer_communications ?? 0}</Text></dd>
            </div>
            <div>
              <dt><Caption>{t('serviceIntelligence.summary.symptoms', 'Symptom matches')}</Caption></dt>
              <dd><Text variant="metricValue">{summary?.symptom_matches ?? 0}</Text></dd>
            </div>
          </dl>
        </div>
      </PanelState>
    </GlassPanel>
  );
}
