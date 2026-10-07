import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { AlertBanner, QueryError } from '@/components/feedback';
import { Badge, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import type { RegenEfficiencyData } from '@/types/driving';
import type { RegenEfficiencyModel } from '../../lib/regenEfficiency';
import { DetailScopeNotice, RegenMethodologyList, type RegenSectionState } from '../regen-efficiency';
import { isKnownNumber } from '../regen-efficiency-modernization/presentation';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

interface RegenCoverageBriefProps {
  aggregate: RegenEfficiencyData | undefined;
  model: RegenEfficiencyModel;
  aggregateState: RegenSectionState;
  detailState: RegenSectionState;
  scope: string;
  retained: boolean;
}

export function RegenCoverageBrief({ aggregate, model, aggregateState, detailState, scope, retained }: RegenCoverageBriefProps) {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();
  const unavailableEnergyFields = model.accounting.missingFields.regenEnergyWh + model.accounting.missingFields.energyUsedWh
    + model.accounting.invalidFields.regenEnergyWh + model.accounting.invalidFields.energyUsedWh;
  const resolved = detailState.isResolved && !detailState.error;
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'regen-method-returned',
      rawValue: resolved ? model.accounting.observedCount : null, label: t('regen.method.returned', 'Rows returned') },
    { metricId: 'count', occurrenceId: 'regen-method-eligible',
      rawValue: resolved ? model.accounting.eligibleCount : null, label: t('regen.method.eligible', 'Eligible drives') },
    { metricId: 'count', occurrenceId: 'regen-method-excluded',
      rawValue: resolved ? model.accounting.excludedCount : null, label: t('regen.method.excluded', 'Excluded drives') },
    { metricId: 'count', occurrenceId: 'regen-method-unavailable',
      rawValue: resolved ? unavailableEnergyFields : null, label: t('regen.method.unavailableFields', 'Unavailable energy fields') },
  ];
  const aggregateStatus = aggregateState.isLoading
    ? t('regen.method.aggregateLoading', 'Aggregate query loading')
    : aggregateState.error ? t('regen.method.aggregateError', 'Aggregate query unavailable')
      : aggregate ? t('regen.method.aggregateReady', 'Complete aggregate loaded')
        : t('regen.method.aggregateEmpty', 'No aggregate response');
  const detailStatus = detailState.isLoading ? t('regen.method.detailLoading', 'Detailed query loading')
    : detailState.error ? t('regen.method.detailError', 'Detailed query unavailable')
      : !detailState.isResolved ? t('regen.method.detailPending', 'Detailed availability not resolved')
        : model.accounting.observedCount > 0 ? t('regen.method.detailReady', 'Detailed returned window loaded')
          : t('regen.method.detailEmpty', 'No detailed rows returned');
  const capacityProvenance = aggregate?.capacitySource === 'vin_estimate'
    ? t('regen.method.capacityVin', 'VIN-based estimate')
    : aggregate?.capacitySource === 'model_estimate' ? t('regen.method.capacityModel', 'Model-based estimate')
      : aggregate?.capacitySource === 'default' ? t('regen.method.capacityDefault', 'Platform default estimate') : '—';
  return (
    <section data-testid="regen-methodology" aria-label={t('regen.method.sectionAria', 'Coverage and methodology')}>
      <DrivingSummaryBrief
        id="regen-coverage-brief"
        title={t('regen.method.title', 'Coverage & methodology')}
        description={t('regen.method.subtitle', 'Two evidence scopes are kept separate so complete totals are not confused with capped drive detail.')}
        metrics={metrics} scope={scope}
        provenance={t('regen.brief.provenance', 'Complete recovery aggregate and independently returned capped drive detail.')}
        loading={detailState.isLoading} unavailable={!resolved} retained={retained}
        actions={<>
          <Badge variant={aggregateState.error ? 'danger' : aggregateState.isLoading || !aggregateState.isResolved || !aggregate ? 'neutral' : 'success'}>{aggregateStatus}</Badge>
          <Badge variant={detailState.error ? 'danger' : detailState.isLoading || !detailState.isResolved ? 'neutral' : model.accounting.historyCapReached ? 'warning' : 'info'}>{detailStatus}</Badge>
        </>}
      />
      {detailState.error && <QueryError error={detailState.error} onRetry={detailState.onRetry} />}
      {!detailState.isResolved && !detailState.isLoading && !detailState.error && <AlertBanner variant="info">
        <Text as="p" variant="caption">{t('regen.states.detailPending', 'Detailed data availability has not resolved.')}</Text>
      </AlertBanner>}
      {aggregate != null && <AlertBanner variant="info">
        <Text as="p" variant="caption">{t('regen.method.capacityProvenance', 'Pack basis: {{capacity}} · {{source}}.', {
          capacity: isKnownNumber(aggregate.batteryCapacityWh) ? formatEnergy(aggregate.batteryCapacityWh) : '—', source: capacityProvenance,
        })}</Text>
      </AlertBanner>}
      {detailState.isResolved && <DetailScopeNotice capReached={model.accounting.historyCapReached} historyLimit={model.accounting.historyLimit} />}
      <RegenMethodologyList historyLimit={model.accounting.historyLimit} />
    </section>
  );
}
