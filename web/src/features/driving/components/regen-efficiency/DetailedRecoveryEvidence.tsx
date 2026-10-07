import { Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import {
  MetricLabel,
  MetricValue,
  Subhead,
  Text,
} from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { fmtPercent } from '@/lib/numberFormat';

import type { RegenEfficiencyModel } from '../../lib/regenEfficiency';
import type { RegenSectionState } from './types';

interface DetailedRecoveryEvidenceProps {
  model: RegenEfficiencyModel;
  state: RegenSectionState;
}

export function DetailedRecoveryEvidence({
  model,
  state,
}: DetailedRecoveryEvidenceProps) {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <Subhead className="flex items-center gap-2">
        <Scale className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('regen.overview.sampleTitle', 'Detailed returned sample')}
      </Subhead>
      <Text as="p" variant="caption" className="mt-1">
        {t(
          'regen.overview.sampleScope',
          'Measured canonical Drive rows returned by the capped detailed request.',
        )}
      </Text>
      <div className="mt-4 min-h-56">
        {state.isLoading ? (
          <Skeleton height={220} />
        ) : state.error ? (
          <QueryError error={state.error} onRetry={state.onRetry} />
        ) : !state.isResolved ? (
          <EmptyState
            className="py-8"
            icon={<Scale className="h-7 w-7" aria-hidden="true" />}
            message={t(
              'regen.states.detailPending',
              'Detailed data availability has not resolved.',
            )}
          />
        ) : model.accounting.eligibleCount === 0 ? (
          <EmptyState /* no-action: eligibility depends on measured drive fields. */
            className="py-8"
            icon={<Scale className="h-7 w-7" aria-hidden="true" />}
            message={
              model.accounting.observedCount === 0
                ? t(
                    'regen.overview.sampleEmpty',
                    'No detailed drives were returned for this window.',
                  )
                : t(
                    'regen.overview.sampleIneligible',
                    'Returned drives lack an eligible regen and drive-energy pair.',
                  )
            }
          />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-white/[0.03] p-3">
                <MetricValue>
                  {formatEnergy(model.totalMeasuredRegenWh, { precision: 1 })}
                </MetricValue>
                <MetricLabel>
                  {t('regen.overview.sampleRecovered', 'Sample recovered')}
                </MetricLabel>
              </div>
              <div className="rounded-xl bg-white/[0.03] p-3">
                <MetricValue>
                  {formatEnergy(model.totalMeasuredDriveEnergyWh, {
                    precision: 1,
                  })}
                </MetricValue>
                <MetricLabel>
                  {t(
                    'regen.overview.sampleDenominator',
                    'Sample drive energy',
                  )}
                </MetricLabel>
              </div>
              <div className="rounded-xl bg-white/[0.03] p-3">
                <MetricValue>
                  {model.energyWeightedRatioPct != null
                    ? fmtPercent(model.energyWeightedRatioPct, 1)
                    : '—'}
                </MetricValue>
                <MetricLabel>
                  {t(
                    'regen.overview.sampleWeighted',
                    'Energy-weighted share',
                  )}
                </MetricLabel>
              </div>
            </div>
            <div className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-3">
              <Text as="p" variant="bodySm">
                {t(
                  'regen.overview.quartiles',
                  'Eligible per-drive ratios: Q1 {{q1}}, median {{median}}, Q3 {{q3}}.',
                  {
                    q1:
                      model.ratioStatistics.q1Pct != null
                        ? fmtPercent(model.ratioStatistics.q1Pct, 1)
                        : '—',
                    median:
                      model.ratioStatistics.medianPct != null
                        ? fmtPercent(model.ratioStatistics.medianPct, 1)
                        : '—',
                    q3:
                      model.ratioStatistics.q3Pct != null
                        ? fmtPercent(model.ratioStatistics.q3Pct, 1)
                        : '—',
                  },
                )}
              </Text>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
