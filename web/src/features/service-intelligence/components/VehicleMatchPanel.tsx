import { useTranslation } from 'react-i18next';
import { CarFront } from 'lucide-react';
import { Table, Caption, Text } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
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
    <LayoutCard title={t('serviceIntelligence.vehicle.title', 'Vehicle match context')}
      actions={<CarFront className="h-4 w-4 text-cyan-300" aria-hidden="true" />}>
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
          <Table aria-label={t('serviceIntelligence.vehicle.title', 'Vehicle match context')}><tbody>
            <tr>
              <th scope="row"><Caption>{t('serviceIntelligence.vehicle.model', 'Vehicle')}</Caption></th>
              <td><Text variant="body">{context ? `${context.make} ${context.model}` : unavailable}</Text></td>
            </tr>
            <tr>
              <th scope="row"><Caption>{t('serviceIntelligence.vehicle.modelYear', 'Model year')}</Caption></th>
              <td className="text-right"><Text variant="body">{display(context?.model_year ?? null, unavailable)}</Text></td>
            </tr>
            <tr>
              <th scope="row"><Caption>{t('serviceIntelligence.vehicle.assemblyPlant', 'Assembly plant')}</Caption></th>
              <td><Text variant="body">{display(plant, unavailable)}</Text></td>
            </tr>
            <tr>
              <th scope="row"><Caption>{t('serviceIntelligence.vehicle.firmware', 'Observed firmware')}</Caption></th>
              <td><Text variant="body" mono>{display(context?.firmware_version ?? null, unavailable)}</Text></td>
            </tr>
          </tbody></Table>
          <Text as="p" variant="helper">{context?.build_match_basis ?? unavailable}</Text>
          <Table aria-label={t('serviceIntelligence.vehicle.title', 'Vehicle match context')}><tbody>
            <tr>
              <th scope="row"><Caption>{t('serviceIntelligence.summary.recallCandidates', 'Recall candidates')}</Caption></th>
              <td className="text-right"><Text variant="metricValue">{summary?.recall_candidates ?? 0}</Text></td>
            </tr>
            <tr>
              <th scope="row"><Caption>{t('serviceIntelligence.summary.applicable', 'Potentially applicable')}</Caption></th>
              <td className="text-right"><Text variant="metricValue">{summary?.potentially_applicable_recalls ?? 0}</Text></td>
            </tr>
            <tr>
              <th scope="row"><Caption>{t('serviceIntelligence.summary.communications', 'Communications')}</Caption></th>
              <td className="text-right"><Text variant="metricValue">{summary?.manufacturer_communications ?? 0}</Text></td>
            </tr>
            <tr>
              <th scope="row"><Caption>{t('serviceIntelligence.summary.symptoms', 'Symptom matches')}</Caption></th>
              <td className="text-right"><Text variant="metricValue">{summary?.symptom_matches ?? 0}</Text></td>
            </tr>
          </tbody></Table>
        </div>
      </PanelState>
    </LayoutCard>
  );
}
