import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { EmptyState, QueryError } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';
import type { RegenEfficiencyData } from '@/types/driving';
import type { RegenEfficiencyModel } from '../../lib/regenEfficiency';
import { DetailScopeNotice, type RegenSectionState } from '../regen-efficiency';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

interface RegenSummaryBriefProps {
  aggregate: RegenEfficiencyData | undefined;
  model: RegenEfficiencyModel;
  aggregateState: RegenSectionState;
  detailState: RegenSectionState;
  retained: boolean;
  scope: string;
}

export function RegenSummaryBrief({
  aggregate, model, aggregateState, detailState, retained, scope,
}: RegenSummaryBriefProps) {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();
  const { fmtPercent, fmtInt, fmtNumber } = useNumberFormatting();
  const aggregateTotalsUnavailable = detailState.isResolved && aggregate != null
    && aggregate.totalRegenWh === 0 && aggregate.totalDriveWh === 0
    && model.totalMeasuredDriveEnergyWh > 0;
  const aggregateUnavailable = aggregateState.isLoading || !aggregateState.isResolved
    || aggregateState.error != null || aggregate == null || aggregateTotalsUnavailable;
  const detailUnavailable = detailState.isLoading || !detailState.isResolved || detailState.error != null;
  const returnedRowsSubtitle = detailState.isLoading
    ? t('regen.states.detailLoading', 'Detailed query loading.')
    : detailState.error
      ? t('regen.states.detailUnavailable', 'Detailed query unavailable.')
      : !detailState.isResolved
        ? t('regen.states.detailPending', 'Detailed data availability has not resolved.')
        : model.accounting.historyCapReached
          ? t('regen.kpis.returnedRowsCapped', '{{limit}}-row cap reached', { limit: fmtInt(model.accounting.historyLimit) })
          : t('regen.kpis.returnedRowsBelowCap', 'Below the {{limit}}-row request cap', { limit: fmtInt(model.accounting.historyLimit) });
  const noResolvedEvidence = aggregateState.isResolved && detailState.isResolved
    && (aggregate == null || (aggregate.totalRegenWh === 0 && aggregate.totalDriveWh === 0))
    && model.accounting.observedCount === 0;
  const metrics: readonly StatMetric[] = [
    {
      metricId: 'energy', occurrenceId: 'regen-aggregate-recovered',
      label: t('regen.kpis.aggregateRecovered', 'Aggregate recovered'),
      rawValue: aggregateUnavailable ? null : aggregate?.totalRegenWh,
      description: t('regen.kpis.aggregateRecoveredHint', 'Complete date-scoped aggregate'),
      display: { formatter: (raw) => ({ value: formatEnergy(raw), unit: '' }) },
    },
    {
      metricId: 'percent', occurrenceId: 'regen-aggregate-share',
      label: t('regen.kpis.aggregateShare', 'Aggregate recovery share'),
      rawValue: !aggregateUnavailable && aggregate != null && Number.isFinite(aggregate.totalDriveWh)
        && aggregate.totalDriveWh > 0 ? aggregate.regenRatio : null,
      description: t('regen.kpis.aggregateShareHint', 'Recovered energy ÷ drive-energy denominator'),
      display: { formatter: (raw) => ({ value: fmtPercent(raw), unit: '' }) },
    },
    {
      metricId: 'number', occurrenceId: 'regen-pack-cycles',
      label: t('regen.kpis.packCycles', 'Equivalent full-pack cycles'),
      rawValue: aggregateUnavailable ? null : aggregate?.freeCharges,
      description: t('regen.kpis.packCyclesHint', 'Using the reported capacity estimate'),
      display: { formatter: (raw) => ({ value: fmtNumber(raw), unit: '' }) },
    },
    {
      metricId: 'energy', occurrenceId: 'regen-aggregate-denominator',
      label: t('regen.kpis.aggregateDenominator', 'Aggregate drive energy'),
      rawValue: aggregateUnavailable ? null : aggregate?.totalDriveWh,
      description: t('regen.kpis.aggregateDenominatorHint', 'Complete recovery denominator'),
      display: { formatter: (raw) => ({ value: formatEnergy(raw), unit: '' }) },
    },
    {
      metricId: 'count', occurrenceId: 'regen-returned-rows',
      label: t('regen.kpis.returnedRows', 'Detailed rows returned'),
      rawValue: detailUnavailable ? null : model.accounting.observedCount,
      description: returnedRowsSubtitle,
    },
    {
      metricId: 'count', occurrenceId: 'regen-eligible-coverage',
      label: t('regen.kpis.eligibleCoverage', 'Eligible detailed coverage'),
      rawValue: detailUnavailable ? null : model.accounting.eligibleCount,
      display: { countTotal: model.accounting.observedCount },
      description: t('regen.kpis.eligibleCoverageHint', 'Measured regen and positive drive energy'),
      context: !detailUnavailable ? t('regen.kpis.coverageValue', '{{eligible}} / {{observed}}', {
        eligible: fmtInt(model.accounting.eligibleCount), observed: fmtInt(model.accounting.observedCount),
      }) : returnedRowsSubtitle,
    },
  ];
  return (
    <section data-testid="regen-kpis" aria-label={t('regen.kpis.aria', 'Selected-window recovery summary')}>
      <DrivingSummaryBrief
        id="regen-selected-window-summary"
        title={t('regen.kpis.title', 'Selected-window evidence')}
        description={t('regen.method.subtitle', 'Two evidence scopes are kept separate so complete totals are not confused with capped drive detail.')}
        metrics={metrics}
        scope={scope}
        provenance={t('regen.brief.provenance', 'Complete recovery aggregate and independently returned capped drive detail.')}
        loading={aggregateState.isLoading && detailState.isLoading}
        unavailable={aggregateUnavailable || detailUnavailable}
        retained={retained}
        sourceStatus={aggregateUnavailable !== detailUnavailable
          ? t('regen.brief.partialSources', 'Independent sources partly available') : undefined}
      />
      {aggregateState.error != null && <div data-testid="regen-kpis-aggregate-error">
        <QueryError error={aggregateState.error} onRetry={aggregateState.onRetry} />
      </div>}
      {detailState.error != null && <div data-testid="regen-kpis-detail-error">
        <QueryError error={detailState.error} onRetry={detailState.onRetry} />
      </div>}
      {noResolvedEvidence && <EmptyState
        action={{ label: t('common.retry', 'Retry'), onClick: () => {
          aggregateState.onRetry(); detailState.onRetry();
        } }}
        message={t('regen.kpis.empty', 'No aggregate energy or detailed drives were returned for this selected window.')}
      />}
      {detailState.isResolved && <DetailScopeNotice className="mt-4"
        capReached={model.accounting.historyCapReached} historyLimit={model.accounting.historyLimit} />}
    </section>
  );
}
