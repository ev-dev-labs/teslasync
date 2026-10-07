import { Gauge, Layers3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CHART_COLORS, LinearGauge } from '@/components/charts';
import {
  AlertBanner,
  EmptyState,
  QueryError,
  Skeleton,
} from '@/components/feedback';
import {
  MetricLabel,
  MetricValue,
  Subhead,
  Text,
} from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import type {
  RegenCapacitySource,
  RegenEfficiencyData,
} from '@/types/driving';

import type { RegenSectionState } from './types';

interface AggregateRecoveryEvidenceProps {
  aggregate: RegenEfficiencyData | undefined;
  detailedMeasuredDriveEnergyWh: number;
  state: RegenSectionState;
}

export function AggregateRecoveryEvidence({
  aggregate,
  detailedMeasuredDriveEnergyWh,
  state,
}: AggregateRecoveryEvidenceProps) {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();
  const totalsUnavailable =
    aggregate != null &&
    aggregate.totalRegenWh === 0 &&
    aggregate.totalDriveWh === 0 &&
    detailedMeasuredDriveEnergyWh > 0;
  const capacitySource = (source: RegenCapacitySource): string => {
    switch (source) {
      case 'vin_estimate':
        return t('regen.overview.capacityVin', 'VIN-based estimate');
      case 'model_estimate':
        return t('regen.overview.capacityModel', 'Model-based estimate');
      case 'default':
        return t('regen.overview.capacityDefault', 'Platform default estimate');
    }
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <Subhead className="flex items-center gap-2">
        <Layers3 className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        {t('regen.overview.aggregateTitle', 'Complete aggregate')}
      </Subhead>
      <Text as="p" variant="caption" className="mt-1">
        {t(
          'regen.overview.aggregateScope',
          'All aggregate energy in the selected date window; not limited by the detailed row cap.',
        )}
      </Text>
      <div className="mt-4 min-h-56">
        {state.isLoading ? (
          <Skeleton height={220} />
        ) : state.error ? (
          <QueryError error={state.error} onRetry={state.onRetry} />
        ) : aggregate == null ? (
          <EmptyState /* no-action: aggregate data follows the selected controls. */
            className="py-8"
            icon={<Gauge className="h-7 w-7" aria-hidden="true" />}
            message={t(
              'regen.overview.aggregateEmpty',
              'No aggregate recovery response is available for this window.',
            )}
          />
        ) : (
          <div className="space-y-4">
            {totalsUnavailable ? (
              <AlertBanner
                variant="warning"
                title={t(
                  'regen.overview.aggregateUnavailableTitle',
                  'Aggregate totals unavailable',
                )}
              >
                <Text as="p" variant="caption">
                  {t(
                    'regen.overview.aggregateUnavailable',
                    'The aggregate endpoint returned zero totals while the detailed sample contains measured drive energy. Treat the complete aggregate as unavailable, not as evidence of 0% recovery.',
                  )}
                </Text>
              </AlertBanner>
            ) : Number.isFinite(aggregate.totalDriveWh) &&
              aggregate.totalDriveWh > 0 ? (
              <div className="flex flex-col items-center gap-3">
                <LinearGauge
                  value={
                    Number.isFinite(aggregate.regenRatio)
                      ? aggregate.regenRatio
                      : 0
                  }
                  max={100}
                  label={t(
                    'regen.overview.aggregateGauge',
                    'Aggregate recovery share',
                  )}
                  unit="%"
                  color={CHART_COLORS[1]}
                  size={168}
                />
                <Text as="p" variant="caption" className="text-center">
                  {t(
                    'regen.recoveredInfo',
                    'The complete aggregate reports {{recovered}} recovered from {{driveEnergy}} of drive energy.',
                    {
                      recovered: formatEnergy(aggregate.totalRegenWh, {
                        precision: 1,
                      }),
                      driveEnergy: formatEnergy(aggregate.totalDriveWh, {
                        precision: 1,
                      }),
                    },
                  )}
                </Text>
              </div>
            ) : (
              <EmptyState /* no-action: zero aggregate energy is a resolved selected-window result. */
                className="py-6"
                icon={<Gauge className="h-7 w-7" aria-hidden="true" />}
                message={t(
                  'regen.overview.aggregateNoEnergy',
                  'The complete aggregate contains no drive-energy denominator for this window.',
                )}
              />
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white/[0.03] p-3">
                <MetricValue>
                  {formatEnergy(aggregate.batteryCapacityWh, { precision: 1 })}
                </MetricValue>
                <MetricLabel>
                  {t(
                    'regen.overview.capacityBasis',
                    'Estimated usable pack basis',
                  )}
                </MetricLabel>
              </div>
              <div className="rounded-xl bg-white/[0.03] p-3">
                <MetricValue className="text-base">
                  {capacitySource(aggregate.capacitySource)}
                </MetricValue>
                <MetricLabel>
                  {t('regen.overview.capacitySource', 'Capacity source')}
                </MetricLabel>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
