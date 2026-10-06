import { useTranslation } from 'react-i18next';
import { CHART_COLORS, LinearGauge } from '@/components/charts';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { AlertBanner, EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { LayoutCard } from '@/components/layout';
import { Subhead, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { RegenEfficiencyData } from '@/types/driving';
import type { RegenEfficiencyModel } from '../../lib/regenEfficiency';
import { DetailScopeNotice, type RegenSectionState } from '../regen-efficiency';
import { isKnownNumber } from '../regen-efficiency-modernization/presentation';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

interface RegenOverviewBriefProps {
  aggregate: RegenEfficiencyData | undefined;
  model: RegenEfficiencyModel;
  aggregateState: RegenSectionState;
  detailState: RegenSectionState;
  scope: string;
  retained: boolean;
}

export function RegenOverviewBrief({ aggregate, model, aggregateState, detailState, scope, retained }: RegenOverviewBriefProps) {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();
  const { fmtPercent } = useNumberFormatting();
  const capacitySource = aggregate?.capacitySource === 'vin_estimate'
    ? t('regen.overview.capacityVin', 'VIN-based estimate')
    : aggregate?.capacitySource === 'model_estimate'
      ? t('regen.overview.capacityModel', 'Model-based estimate')
      : aggregate?.capacitySource === 'default'
        ? t('regen.overview.capacityDefault', 'Platform default estimate') : null;
  const aggregateReady = aggregateState.isResolved && !aggregateState.error;
  const detailReady = detailState.isResolved && !detailState.error && model.accounting.eligibleCount > 0;
  const totalsUnavailable = aggregate != null && aggregate.totalRegenWh === 0 && aggregate.totalDriveWh === 0
    && detailState.isResolved && model.totalMeasuredDriveEnergyWh > 0;
  const hasDenominator = isKnownNumber(aggregate?.totalDriveWh) && aggregate.totalDriveWh > 0;
  const metrics: readonly StatMetric[] = [
    {
      metricId: 'energy', occurrenceId: 'regen-capacity-basis',
      rawValue: aggregateReady ? aggregate?.batteryCapacityWh : null,
      label: t('regen.overview.capacityBasis', 'Estimated usable pack basis'),
      description: t('regen.method.capacity', 'Equivalent full-pack cycles use an estimated usable battery capacity reported by the aggregate endpoint. The estimate is provenance context, not a measured capacity test.'),
      display: { formatter: (raw) => ({ value: formatEnergy(raw), unit: '' }) },
    },
    {
      metricId: 'status', occurrenceId: 'regen-capacity-source',
      rawValue: aggregateReady ? capacitySource : null,
      label: t('regen.overview.capacitySource', 'Capacity source'),
    },
    {
      metricId: 'energy', occurrenceId: 'regen-sample-recovered',
      rawValue: detailReady ? model.totalMeasuredRegenWh : null,
      label: t('regen.overview.sampleRecovered', 'Sample recovered'),
      display: { formatter: (raw) => ({ value: formatEnergy(raw), unit: '' }) },
      description: t('regen.overview.sampleScope', 'Measured canonical Drive rows returned by the capped detailed request.'),
    },
    {
      metricId: 'energy', occurrenceId: 'regen-sample-denominator',
      rawValue: detailReady ? model.totalMeasuredDriveEnergyWh : null,
      label: t('regen.overview.sampleDenominator', 'Sample drive energy'),
      display: { formatter: (raw) => ({ value: formatEnergy(raw), unit: '' }) },
    },
    {
      metricId: 'percent', occurrenceId: 'regen-sample-weighted',
      rawValue: detailReady ? model.energyWeightedRatioPct : null,
      label: t('regen.overview.sampleWeighted', 'Energy-weighted share'),
      display: { formatter: (raw) => ({ value: fmtPercent(raw), unit: '' }) },
      context: detailReady ? t('regen.overview.quartiles', 'Eligible per-drive ratios: Q1 {{q1}}, median {{median}}, Q3 {{q3}}.', {
        q1: isKnownNumber(model.ratioStatistics.q1Pct) ? fmtPercent(model.ratioStatistics.q1Pct) : '—',
        median: isKnownNumber(model.ratioStatistics.medianPct) ? fmtPercent(model.ratioStatistics.medianPct) : '—',
        q3: isKnownNumber(model.ratioStatistics.q3Pct) ? fmtPercent(model.ratioStatistics.q3Pct) : '—',
      }) : undefined,
    },
  ];
  return (
    <section data-testid="regen-overview" aria-label={t('regen.overview.aria', 'Aggregate and detailed recovery overview')}>
      <DrivingSummaryBrief
        id="regen-overview-brief"
        title={t('regen.overview.title', 'Recovery overview')}
        description={t('regen.method.subtitle', 'Two evidence scopes are kept separate so complete totals are not confused with capped drive detail.')}
        metrics={metrics}
        scope={scope}
        provenance={t('regen.brief.provenance', 'Complete recovery aggregate and independently returned capped drive detail.')}
        loading={aggregateState.isLoading && detailState.isLoading}
        unavailable={!aggregateReady || !detailReady}
        retained={retained}
        sourceStatus={aggregateReady !== detailReady
          ? t('regen.brief.partialSources', 'Independent sources partly available') : undefined}
      />
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <LayoutCard title={t('regen.overview.aggregateTitle', 'Complete aggregate')}>
          <Text as="p" variant="caption">{t('regen.overview.aggregateScope', 'All aggregate energy in the selected date window; not limited by the detailed row cap.')}</Text>
          {aggregateState.isLoading ? <Skeleton height={220} />
            : aggregateState.error ? <QueryError error={aggregateState.error} onRetry={aggregateState.onRetry} />
            : aggregate == null ? <EmptyState
              action={aggregateState.isResolved ? { label: t('common.retry', 'Retry'), onClick: aggregateState.onRetry } : undefined}
              message={t('regen.overview.aggregateEmpty', 'No aggregate recovery response is available for this window.')} />
            : totalsUnavailable ? <AlertBanner variant="warning" title={t('regen.overview.aggregateUnavailableTitle', 'Aggregate totals unavailable')}>
              <Text as="p" variant="caption">{t('regen.overview.aggregateUnavailable', 'The aggregate endpoint returned zero totals while the detailed sample contains measured drive energy. Treat the complete aggregate as unavailable, not as evidence of 0% recovery.')}</Text>
            </AlertBanner>
            : hasDenominator ? <div className="flex flex-col items-center gap-3">
              {isKnownNumber(aggregate.regenRatio) ? <LinearGauge
                value={aggregate.regenRatio} max={100}
                label={t('regen.overview.aggregateGauge', 'Aggregate recovery share')}
                unit="%" color={CHART_COLORS[1]} size={168}
              /> : <EmptyState action={{ label: t('common.retry', 'Retry'), onClick: aggregateState.onRetry }}
                message={t('regen.modernization.ratioUnavailable', 'Recovery share is unavailable; no zero value is inferred.')} />}
              <Text as="p" variant="caption">{t('regen.recoveredInfo', 'The complete aggregate reports {{recovered}} recovered from {{driveEnergy}} of drive energy.', {
                recovered: isKnownNumber(aggregate.totalRegenWh) ? formatEnergy(aggregate.totalRegenWh) : '—',
                driveEnergy: formatEnergy(aggregate.totalDriveWh),
              })}</Text>
            </div> : <EmptyState action={{ label: t('common.retry', 'Retry'), onClick: aggregateState.onRetry }}
              message={isKnownNumber(aggregate.totalDriveWh)
                ? t('regen.overview.aggregateNoEnergy', 'The complete aggregate contains no drive-energy denominator for this window.')
                : t('regen.modernization.denominatorUnavailable', 'The aggregate drive-energy denominator is unavailable.')} />}
        </LayoutCard>
        <LayoutCard title={t('regen.overview.sampleTitle', 'Detailed returned sample')}>
          <Subhead>{t('regen.overview.sampleScope', 'Measured canonical Drive rows returned by the capped detailed request.')}</Subhead>
          {detailState.isLoading ? <Skeleton height={220} />
            : detailState.error ? <QueryError error={detailState.error} onRetry={detailState.onRetry} />
            : !detailState.isResolved ? <EmptyState message={t('regen.states.detailPending', 'Detailed data availability has not resolved.')} />
            : model.accounting.eligibleCount === 0 ? <EmptyState
              action={{ label: t('common.retry', 'Retry'), onClick: detailState.onRetry }}
              message={model.accounting.observedCount === 0
                ? t('regen.overview.sampleEmpty', 'No detailed drives were returned for this window.')
                : t('regen.overview.sampleIneligible', 'Returned drives lack an eligible regen and drive-energy pair.')} />
            : <Text as="p" variant="bodySm">{t('regen.overview.quartiles', 'Eligible per-drive ratios: Q1 {{q1}}, median {{median}}, Q3 {{q3}}.', {
              q1: isKnownNumber(model.ratioStatistics.q1Pct) ? fmtPercent(model.ratioStatistics.q1Pct) : '—',
              median: isKnownNumber(model.ratioStatistics.medianPct) ? fmtPercent(model.ratioStatistics.medianPct) : '—',
              q3: isKnownNumber(model.ratioStatistics.q3Pct) ? fmtPercent(model.ratioStatistics.q3Pct) : '—',
            })}</Text>}
        </LayoutCard>
      </div>
      {detailState.isResolved && <DetailScopeNotice className="mt-4"
        capReached={model.accounting.historyCapReached} historyLimit={model.accounting.historyLimit} />}
    </section>
  );
}
