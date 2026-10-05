import { useTranslation } from 'react-i18next';
import { StatStrip, type StatMetric } from '@/components/data-display/stat-reference';
import { EmptyState, QueryError } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';
import type { RegenEfficiencyData } from '@/types/driving';
import type { RegenEfficiencyModel } from '../../lib/regenEfficiency';
import { DetailScopeNotice, type RegenSectionState } from '../regen-efficiency';
import { isKnownNumber } from './presentation';

interface RegenKpiBandProps {
  aggregate: RegenEfficiencyData | undefined;
  model: RegenEfficiencyModel;
  aggregateState: RegenSectionState;
  detailState: RegenSectionState;
  retained: boolean;
}

export function RegenKpiBand({
  aggregate, model, aggregateState, detailState, retained,
}: RegenKpiBandProps) {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();
  const { fmtPercent, fmtInt, fmtNumber } = useNumberFormatting();
  const aggregateTotalsUnavailable =
    detailState.isResolved &&
    aggregate != null &&
    aggregate.totalRegenWh === 0 &&
    aggregate.totalDriveWh === 0 &&
    model.totalMeasuredDriveEnergyWh > 0;
  const aggregateUnavailable =
    aggregateState.isLoading ||
    !aggregateState.isResolved ||
    aggregateState.error != null ||
    aggregate == null ||
    aggregateTotalsUnavailable;
  const detailUnavailable =
    detailState.isLoading || !detailState.isResolved || detailState.error != null;
  const aggregateValue = (value: string | null): string | null =>
    aggregateState.isLoading
      ? t('regen.states.loadingShort', 'Loading…')
      : aggregateUnavailable ? null : value;
  const detailValue = (value: string): string | null =>
    detailState.isLoading
      ? t('regen.states.loadingShort', 'Loading…')
      : detailUnavailable ? null : value;
  const aggregateRecoveryShare =
    aggregate != null &&
    isKnownNumber(aggregate.totalDriveWh) &&
    aggregate.totalDriveWh > 0 &&
    isKnownNumber(aggregate.regenRatio)
      ? fmtPercent(aggregate.regenRatio) : null;
  const returnedRowsSubtitle = detailState.isLoading
    ? t('regen.states.detailLoading', 'Detailed query loading.')
    : detailState.error
      ? t('regen.states.detailUnavailable', 'Detailed query unavailable.')
      : !detailState.isResolved
        ? t('regen.states.detailPending', 'Detailed data availability has not resolved.')
        : model.accounting.historyCapReached
          ? t('regen.kpis.returnedRowsCapped', '{{limit}}-row cap reached', {
              limit: fmtInt(model.accounting.historyLimit),
            })
          : t('regen.kpis.returnedRowsBelowCap', 'Below the {{limit}}-row request cap', {
              limit: fmtInt(model.accounting.historyLimit),
            });
  const noResolvedEvidence =
    aggregateState.isResolved &&
    detailState.isResolved &&
    (aggregate == null || (aggregate.totalRegenWh === 0 && aggregate.totalDriveWh === 0)) &&
    model.accounting.observedCount === 0;

  // The reference text contract deliberately retains specialist useUnits and
  // number-formatting output. No generic energy/ratio formatter substitution:
  // raw SI remains untouched in aggregate/model and in the table/chart exports.
  const metrics: StatMetric[] = [
    {
      metricId: 'text',
      occurrenceId: 'regen-aggregate-recovered',
      label: t('regen.kpis.aggregateRecovered', 'Aggregate recovered'),
      rawValue: aggregateValue(isKnownNumber(aggregate?.totalRegenWh)
        ? formatEnergy(aggregate.totalRegenWh) : null),
      description: t('regen.kpis.aggregateRecoveredHint', 'Complete date-scoped aggregate'),
      context: t('regen.kpis.aggregateRecoveredHint', 'Complete date-scoped aggregate'),
    },
    {
      metricId: 'text',
      occurrenceId: 'regen-aggregate-share',
      label: t('regen.kpis.aggregateShare', 'Aggregate recovery share'),
      rawValue: aggregateValue(aggregateRecoveryShare),
      description: t('regen.kpis.aggregateShareHint', 'Recovered energy ÷ drive-energy denominator'),
      context: t('regen.kpis.aggregateShareHint', 'Recovered energy ÷ drive-energy denominator'),
    },
    {
      metricId: 'text',
      occurrenceId: 'regen-pack-cycles',
      label: t('regen.kpis.packCycles', 'Equivalent full-pack cycles'),
      rawValue: aggregateValue(isKnownNumber(aggregate?.freeCharges) ? fmtNumber(aggregate.freeCharges) : null),
      description: t('regen.kpis.packCyclesHint', 'Using the reported capacity estimate'),
      context: t('regen.kpis.packCyclesHint', 'Using the reported capacity estimate'),
    },
    {
      metricId: 'text',
      occurrenceId: 'regen-aggregate-denominator',
      label: t('regen.kpis.aggregateDenominator', 'Aggregate drive energy'),
      rawValue: aggregateValue(isKnownNumber(aggregate?.totalDriveWh)
        ? formatEnergy(aggregate.totalDriveWh) : null),
      description: t('regen.kpis.aggregateDenominatorHint', 'Complete recovery denominator'),
      context: t('regen.kpis.aggregateDenominatorHint', 'Complete recovery denominator'),
    },
    {
      metricId: 'text',
      occurrenceId: 'regen-returned-rows',
      label: t('regen.kpis.returnedRows', 'Detailed rows returned'),
      rawValue: detailValue(fmtInt(model.accounting.observedCount)),
      description: returnedRowsSubtitle,
      context: returnedRowsSubtitle,
    },
    {
      metricId: 'text',
      occurrenceId: 'regen-eligible-coverage',
      label: t('regen.kpis.eligibleCoverage', 'Eligible detailed coverage'),
      rawValue: detailValue(t('regen.kpis.coverageValue', '{{eligible}} / {{observed}}', {
        eligible: fmtInt(model.accounting.eligibleCount),
        observed: fmtInt(model.accounting.observedCount),
      })),
      description: t('regen.kpis.eligibleCoverageHint', 'Measured regen and positive drive energy'),
      context: t('regen.kpis.eligibleCoverageHint', 'Measured regen and positive drive energy'),
    },
  ];
  return (
    <section aria-label={t('regen.kpis.aria', 'Selected-window recovery summary')} data-testid="regen-kpis">
      <StatStrip
        id="regen-selected-window-summary"
        title={t('regen.kpis.title', 'Selected-window evidence')}
        metrics={metrics}
        period={{
          kind: 'unknown',
          label: t('regen.kpis.aria', 'Selected-window recovery summary'),
          reason: t('regen.method.subtitle', 'Two evidence scopes are kept separate so complete totals are not confused with capped drive detail.'),
        }}
        retained={retained}
        footer={
          <>
            {aggregateState.error != null && (
              <div data-testid="regen-kpis-aggregate-error">
                <QueryError error={aggregateState.error} onRetry={aggregateState.onRetry} />
              </div>
            )}
            {detailState.error != null && (
              <div data-testid="regen-kpis-detail-error">
                <QueryError error={detailState.error} onRetry={detailState.onRetry} />
              </div>
            )}
            {noResolvedEvidence && <EmptyState
              message={t('regen.kpis.empty', 'No aggregate energy or detailed drives were returned for this selected window.')}
            />}
            {detailState.isResolved && <DetailScopeNotice
              className="mt-4"
              capReached={model.accounting.historyCapReached}
              historyLimit={model.accounting.historyLimit}
            />}
          </>
        }
      />
    </section>
  );
}
