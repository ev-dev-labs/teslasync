import { useTranslation } from 'react-i18next';
import { StatGroup, type StatMetric } from '@/components/data-display/stat-reference';
import { AlertBanner, QueryError, Skeleton } from '@/components/feedback';
import { LayoutCard } from '@/components/layout/layout-reference';
import { Badge, Text } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';
import type { RegenEfficiencyData } from '@/types/driving';
import type { RegenEfficiencyModel } from '../../lib/regenEfficiency';
import { DetailScopeNotice, RegenMethodologyList, type RegenSectionState } from '../regen-efficiency';
import { isKnownNumber } from './presentation';

interface CoverageMethodologyProps {
  aggregate: RegenEfficiencyData | undefined;
  model: RegenEfficiencyModel;
  aggregateState: RegenSectionState;
  detailState: RegenSectionState;
}

export function CoverageMethodology({
  aggregate, model, aggregateState, detailState,
}: CoverageMethodologyProps) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const { formatEnergy } = useUnits();
  const unavailableEnergyFields =
    model.accounting.missingFields.regenEnergyWh +
    model.accounting.missingFields.energyUsedWh +
    model.accounting.invalidFields.regenEnergyWh +
    model.accounting.invalidFields.energyUsedWh;
  const aggregateStatus = aggregateState.isLoading
    ? t('regen.method.aggregateLoading', 'Aggregate query loading')
    : aggregateState.error
      ? t('regen.method.aggregateError', 'Aggregate query unavailable')
      : aggregate
        ? t('regen.method.aggregateReady', 'Complete aggregate loaded')
        : t('regen.method.aggregateEmpty', 'No aggregate response');
  const detailStatus = detailState.isLoading
    ? t('regen.method.detailLoading', 'Detailed query loading')
    : detailState.error
      ? t('regen.method.detailError', 'Detailed query unavailable')
      : !detailState.isResolved
        ? t('regen.method.detailPending', 'Detailed availability not resolved')
        : model.accounting.observedCount > 0
          ? t('regen.method.detailReady', 'Detailed returned window loaded')
          : t('regen.method.detailEmpty', 'No detailed rows returned');
  const capacityProvenance =
    aggregate?.capacitySource === 'vin_estimate'
      ? t('regen.method.capacityVin', 'VIN-based estimate')
      : aggregate?.capacitySource === 'model_estimate'
        ? t('regen.method.capacityModel', 'Model-based estimate')
        : aggregate?.capacitySource === 'default'
          ? t('regen.method.capacityDefault', 'Platform default estimate') : '—';
  const metrics: StatMetric[] = [
    {
      metricId: 'text', occurrenceId: 'regen-method-returned',
      label: t('regen.method.returned', 'Rows returned'),
      rawValue: fmtInt(model.accounting.observedCount),
    },
    {
      metricId: 'text', occurrenceId: 'regen-method-eligible',
      label: t('regen.method.eligible', 'Eligible drives'),
      rawValue: fmtInt(model.accounting.eligibleCount),
    },
    {
      metricId: 'text', occurrenceId: 'regen-method-excluded',
      label: t('regen.method.excluded', 'Excluded drives'),
      rawValue: fmtInt(model.accounting.excludedCount),
    },
    {
      metricId: 'text', occurrenceId: 'regen-method-unavailable',
      label: t('regen.method.unavailableFields', 'Unavailable energy fields'),
      rawValue: fmtInt(unavailableEnergyFields),
    },
  ];
  return (
    <section aria-label={t('regen.method.sectionAria', 'Coverage and methodology')} data-testid="regen-methodology">
      <LayoutCard
        title={t('regen.method.title', 'Coverage & methodology')}
        description={t('regen.method.subtitle', 'Two evidence scopes are kept separate so complete totals are not confused with capped drive detail.')}
      >
        <div className="flex flex-wrap gap-2">
          <Badge variant={aggregateState.error ? 'danger'
            : aggregateState.isLoading || !aggregateState.isResolved || aggregate == null ? 'neutral' : 'success'}>
            {aggregateStatus}
          </Badge>
          <Badge variant={detailState.error ? 'danger'
            : detailState.isLoading || !detailState.isResolved ? 'neutral'
              : model.accounting.historyCapReached ? 'warning' : 'info'}>
            {detailStatus}
          </Badge>
        </div>
        <div className="min-h-24">
          {detailState.isLoading ? <Skeleton height={96} />
            : detailState.error ? <QueryError error={detailState.error} onRetry={detailState.onRetry} />
            : !detailState.isResolved ? <AlertBanner variant="info">
                <Text as="p" variant="caption">
                  {t('regen.states.detailPending', 'Detailed data availability has not resolved.')}
                </Text>
              </AlertBanner>
            : <StatGroup
                period={{ kind: 'unknown', label: t('regen.overview.sampleTitle', 'Detailed returned sample') }}
                metrics={metrics}
              />}
        </div>
        {aggregate != null && <AlertBanner variant="info">
          <Text as="p" variant="caption">
            {t('regen.method.capacityProvenance', 'Pack basis: {{capacity}} · {{source}}.', {
              capacity: isKnownNumber(aggregate.batteryCapacityWh) ? formatEnergy(aggregate.batteryCapacityWh) : '—',
              source: capacityProvenance,
            })}
          </Text>
        </AlertBanner>}
        {detailState.isResolved && <DetailScopeNotice
          capReached={model.accounting.historyCapReached}
          historyLimit={model.accounting.historyLimit}
        />}
        <RegenMethodologyList historyLimit={model.accounting.historyLimit} />
      </LayoutCard>
    </section>
  );
}
