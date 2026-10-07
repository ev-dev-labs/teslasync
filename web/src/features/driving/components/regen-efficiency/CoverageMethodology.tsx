import { BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  AlertBanner,
  QueryError,
  Skeleton,
} from '@/components/feedback';
import {
  Badge,
  GlassPanel,
  MetricLabel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { fmtInt } from '@/lib/numberFormat';
import type { RegenEfficiencyData } from '@/types/driving';

import type { RegenEfficiencyModel } from '../../lib/regenEfficiency';
import { DetailScopeNotice } from './DetailScopeNotice';
import { RegenMethodologyList } from './RegenMethodologyList';
import type { RegenSectionState } from './types';

interface CoverageMethodologyProps {
  aggregate: RegenEfficiencyData | undefined;
  model: RegenEfficiencyModel;
  aggregateState: RegenSectionState;
  detailState: RegenSectionState;
}

export function CoverageMethodology({
  aggregate,
  model,
  aggregateState,
  detailState,
}: CoverageMethodologyProps) {
  const { t } = useTranslation();
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
        ? t(
            'regen.method.detailPending',
            'Detailed availability not resolved',
          )
        : model.accounting.observedCount > 0
          ? t('regen.method.detailReady', 'Detailed returned window loaded')
          : t('regen.method.detailEmpty', 'No detailed rows returned');
  const capacityProvenance =
    aggregate?.capacitySource === 'vin_estimate'
      ? t('regen.method.capacityVin', 'VIN-based estimate')
      : aggregate?.capacitySource === 'model_estimate'
        ? t('regen.method.capacityModel', 'Model-based estimate')
        : t('regen.method.capacityDefault', 'Platform default estimate');
  return (
    <section
      aria-label={t('regen.method.sectionAria', 'Coverage and methodology')}
      data-testid="regen-methodology"
    >
      <GlassPanel className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <PanelTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('regen.method.title', 'Coverage & methodology')}
            </PanelTitle>
            <Text as="p" variant="caption" className="mt-1">
              {t(
                'regen.method.subtitle',
                'Two evidence scopes are kept separate so complete totals are not confused with capped drive detail.',
              )}
            </Text>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={
                aggregateState.error
                  ? 'danger'
                  : aggregateState.isLoading
                    ? 'neutral'
                    : 'success'
              }
            >
              {aggregateStatus}
            </Badge>
            <Badge
              variant={
                detailState.error
                  ? 'danger'
                  : detailState.isLoading
                    ? 'neutral'
                    : !detailState.isResolved
                      ? 'neutral'
                      : model.accounting.historyCapReached
                        ? 'warning'
                        : 'info'
              }
            >
              {detailStatus}
            </Badge>
          </div>
        </div>

        <div className="mt-4 min-h-24">
          {detailState.isLoading ? (
            <Skeleton height={96} />
          ) : detailState.error ? (
            <QueryError
              error={detailState.error}
              onRetry={detailState.onRetry}
            />
          ) : !detailState.isResolved ? (
            <AlertBanner variant="info">
              <Text as="p" variant="caption">
                {t(
                  'regen.states.detailPending',
                  'Detailed data availability has not resolved.',
                )}
              </Text>
            </AlertBanner>
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl bg-white/[0.03] p-3">
                <MetricValue>{fmtInt(model.accounting.observedCount)}</MetricValue>
                <MetricLabel>{t('regen.method.returned', 'Rows returned')}</MetricLabel>
              </div>
              <div className="rounded-xl bg-white/[0.03] p-3">
                <MetricValue>{fmtInt(model.accounting.eligibleCount)}</MetricValue>
                <MetricLabel>{t('regen.method.eligible', 'Eligible drives')}</MetricLabel>
              </div>
              <div className="rounded-xl bg-white/[0.03] p-3">
                <MetricValue>{fmtInt(model.accounting.excludedCount)}</MetricValue>
                <MetricLabel>{t('regen.method.excluded', 'Excluded drives')}</MetricLabel>
              </div>
              <div className="rounded-xl bg-white/[0.03] p-3">
                <MetricValue>{fmtInt(unavailableEnergyFields)}</MetricValue>
                <MetricLabel>
                  {t('regen.method.unavailableFields', 'Unavailable energy fields')}
                </MetricLabel>
              </div>
            </div>
          )}
        </div>

        {aggregate ? (
          <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">
              {t(
                'regen.method.capacityProvenance',
                'Pack basis: {{capacity}} · {{source}}.',
                {
                  capacity: formatEnergy(aggregate.batteryCapacityWh, {
                    precision: 1,
                  }),
                  source: capacityProvenance,
                },
              )}
            </Text>
          </AlertBanner>
        ) : null}
        {detailState.isResolved ? (
          <DetailScopeNotice
            className="mt-4"
            capReached={model.accounting.historyCapReached}
            historyLimit={model.accounting.historyLimit}
          />
        ) : null}

        <RegenMethodologyList
          historyLimit={model.accounting.historyLimit}
        />
      </GlassPanel>
    </section>
  );
}
