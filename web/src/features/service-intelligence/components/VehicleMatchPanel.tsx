import { useTranslation } from 'react-i18next';
import { CarFront } from 'lucide-react';
import { Table, Badge, Caption, Text } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { DateTime, OperationalBrief } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type {
  ServiceIntelligenceSource,
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
  generatedAt?: string | null;
  sources?: readonly ServiceIntelligenceSource[];
  retained?: boolean;
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
  generatedAt = null,
  sources = [],
  retained = false,
  onRetry,
}: VehicleMatchPanelProps) {
  const { t } = useTranslation();
  const unavailable = t('serviceIntelligence.common.unavailable', 'Unavailable');
  const plant = context
    ? [context.plant_city, context.plant_state, context.plant_country].filter(Boolean).join(', ')
    : '';
  const metrics: readonly StatMetric[] = [
    {
      metricId: 'count', occurrenceId: 'recall-candidates',
      rawValue: selected ? summary?.recall_candidates : null,
      label: t('serviceIntelligence.summary.recallCandidates', 'Recall candidates'),
      description: t('serviceIntelligence.brief.recallDetail', 'Returned model-year recall candidates, not confirmed vehicle eligibility.'),
      context: sources.map((source) => (
        <div key={source.id}>
          {source.name}{': '}
          {source.status === 'available'
            ? t('serviceIntelligence.sources.available', 'Available')
            : source.status === 'stale'
              ? t('serviceIntelligence.sources.stale', 'Stale')
              : t('serviceIntelligence.sources.unavailable', 'Unavailable')}
          {source.detail && <div>{source.detail}</div>}
          <div>
            {t('serviceIntelligence.sources.checked', 'Checked')}{' '}
            <DateTime value={source.checked_at} variant="full" />
            {' · '}{t('serviceIntelligence.sources.fetched', 'Fetched')}{' '}
            <DateTime value={source.fetched_at} variant="full" />
          </div>
          {source.from_cache && <div>{t('serviceIntelligence.sources.cache', 'Normalized cache')}</div>}
        </div>
      )),
    },
    {
      metricId: 'count', occurrenceId: 'potentially-applicable',
      rawValue: selected ? summary?.potentially_applicable_recalls : null,
      label: t('serviceIntelligence.summary.applicable', 'Potentially applicable'),
      description: t('serviceIntelligence.brief.applicableDetail', 'Returned applicability hypotheses; campaign completion remains unknown.'),
    },
    {
      metricId: 'count', occurrenceId: 'manufacturer-communications',
      rawValue: selected ? summary?.manufacturer_communications : null,
      label: t('serviceIntelligence.summary.communications', 'Communications'),
      description: t('serviceIntelligence.brief.communicationDetail', 'Returned official manufacturer-communication matches, not findings of fault.'),
    },
    {
      metricId: 'count', occurrenceId: 'symptom-matches',
      rawValue: selected ? summary?.symptom_matches : null,
      label: t('serviceIntelligence.summary.symptoms', 'Symptom matches'),
      description: t('serviceIntelligence.brief.symptomDetail', 'Returned observed signal overlaps; match scores and evidence remain in the ranked records below.'),
    },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);

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
          <OperationalBrief
            compact
            testId="service-intelligence-summary"
            eyebrow={t('serviceIntelligence.page.title', 'Recall & service intelligence')}
            title={t('serviceIntelligence.brief.title', 'Service match summary')}
            description={t('serviceIntelligence.brief.description', 'Server-returned recall, communication, and symptom matches are service hypotheses, not findings of fault.')}
            statusLabel={retained
              ? t('serviceIntelligence.brief.retained', 'Retained report')
              : summary == null
                ? t('serviceIntelligence.brief.unavailable', 'Summary unavailable')
                : t('serviceIntelligence.brief.returned', 'Returned report')}
            statusTone={retained || summary == null ? 'warning' : 'neutral'}
            scope={<Badge variant="neutral">{t('serviceIntelligence.brief.scope', 'Selected vehicle · source windows may differ')}</Badge>}
            freshness={<Caption>{t('serviceIntelligence.brief.generated', 'Report generated')}{' '}<DateTime value={generatedAt} variant="full" /></Caption>}
            provenance={t('serviceIntelligence.brief.provenance', 'Decoded vehicle context, NHTSA records, and observed signals. Retrieval freshness is source-specific; counts do not establish eligibility or completion.')}
            metrics={operationalMetrics}
          />
        </div>
      </PanelState>
    </LayoutCard>
  );
}
