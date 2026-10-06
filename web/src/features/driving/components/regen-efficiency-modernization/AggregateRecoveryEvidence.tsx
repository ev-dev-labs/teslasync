import { useTranslation } from 'react-i18next';
import { CHART_COLORS, LinearGauge } from '@/components/charts';
import { StatGroup } from '@/components/data-display/stat-reference';
import { AlertBanner, EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Subhead, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import type { RegenEfficiencyData } from '@/types/driving';
import type { RegenSectionState } from '../regen-efficiency';
import { isKnownNumber } from './presentation';

interface AggregateRecoveryEvidenceProps {
  aggregate: RegenEfficiencyData | undefined;
  detailedMeasuredDriveEnergyWh: number;
  state: RegenSectionState;
}

export function AggregateRecoveryEvidence({
  aggregate, detailedMeasuredDriveEnergyWh, state,
}: AggregateRecoveryEvidenceProps) {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();
  const totalsUnavailable =
    aggregate != null &&
    aggregate.totalRegenWh === 0 &&
    aggregate.totalDriveWh === 0 &&
    detailedMeasuredDriveEnergyWh > 0;
  const capacitySource = aggregate?.capacitySource === 'vin_estimate'
    ? t('regen.overview.capacityVin', 'VIN-based estimate')
    : aggregate?.capacitySource === 'model_estimate'
      ? t('regen.overview.capacityModel', 'Model-based estimate')
      : aggregate?.capacitySource === 'default'
        ? t('regen.overview.capacityDefault', 'Platform default estimate') : null;
  const hasDenominator = isKnownNumber(aggregate?.totalDriveWh) && aggregate.totalDriveWh > 0;
  const hasRatio = isKnownNumber(aggregate?.regenRatio);

  return (
    <div className="min-w-0 rounded-xl border border-[var(--border-default)] p-4">
      <Subhead>{t('regen.overview.aggregateTitle', 'Complete aggregate')}</Subhead>
      <Text as="p" variant="caption" className="mt-1">
        {t('regen.overview.aggregateScope', 'All aggregate energy in the selected date window; not limited by the detailed row cap.')}
      </Text>
      <div className="mt-4 min-h-56">
        {state.isLoading ? <Skeleton height={220} />
          : state.error != null ? <QueryError error={state.error} onRetry={state.onRetry} />
          : aggregate == null ? (
            // no-action: Unresolved query availability is passive; only a resolved missing response can be retried.
            <EmptyState className="py-8"
              action={state.isResolved ? { label: t('common.retry', 'Retry'), onClick: state.onRetry } : undefined}
              message={t('regen.overview.aggregateEmpty', 'No aggregate recovery response is available for this window.')} />
            )
          : (
            <div className="space-y-4">
              {totalsUnavailable ? (
                <AlertBanner variant="warning" title={t('regen.overview.aggregateUnavailableTitle', 'Aggregate totals unavailable')}>
                  <Text as="p" variant="caption">
                    {t('regen.overview.aggregateUnavailable', 'The aggregate endpoint returned zero totals while the detailed sample contains measured drive energy. Treat the complete aggregate as unavailable, not as evidence of 0% recovery.')}
                  </Text>
                </AlertBanner>
              ) : hasDenominator ? (
                <div className="flex flex-col items-center gap-3">
                  {hasRatio ? <LinearGauge
                    value={aggregate.regenRatio}
                    max={100}
                    label={t('regen.overview.aggregateGauge', 'Aggregate recovery share')}
                    unit="%"
                    color={CHART_COLORS[1]}
                    size={168}
                  /> : <EmptyState
                    action={{ label: t('common.retry', 'Retry'), onClick: state.onRetry }}
                    message={t('regen.modernization.ratioUnavailable', 'Recovery share is unavailable; no zero value is inferred.')}
                  />}
                  <Text as="p" variant="caption" className="text-center">
                    {t('regen.recoveredInfo', 'The complete aggregate reports {{recovered}} recovered from {{driveEnergy}} of drive energy.', {
                      recovered: isKnownNumber(aggregate.totalRegenWh) ? formatEnergy(aggregate.totalRegenWh) : '—',
                      driveEnergy: formatEnergy(aggregate.totalDriveWh),
                    })}
                  </Text>
                </div>
              ) : <EmptyState className="py-6" message={
                isKnownNumber(aggregate.totalDriveWh)
                  ? t('regen.overview.aggregateNoEnergy', 'The complete aggregate contains no drive-energy denominator for this window.')
                  : t('regen.modernization.denominatorUnavailable', 'The aggregate drive-energy denominator is unavailable.')
              } action={{ label: t('common.retry', 'Retry'), onClick: state.onRetry }} />}
              <StatGroup
                period={{ kind: 'unknown', label: t('regen.overview.aggregateTitle', 'Complete aggregate') }}
                metrics={[
                  {
                    metricId: 'text',
                    occurrenceId: 'regen-capacity-basis',
                    label: t('regen.overview.capacityBasis', 'Estimated usable pack basis'),
                    description: t('regen.method.capacity', 'Equivalent full-pack cycles use an estimated usable battery capacity reported by the aggregate endpoint. The estimate is provenance context, not a measured capacity test.'),
                    rawValue: isKnownNumber(aggregate.batteryCapacityWh) ? formatEnergy(aggregate.batteryCapacityWh) : null,
                  },
                  {
                    metricId: 'text',
                    occurrenceId: 'regen-capacity-source',
                    label: t('regen.overview.capacitySource', 'Capacity source'),
                    rawValue: capacitySource,
                  },
                ]}
              />
            </div>
          )}
      </div>
    </div>
  );
}
