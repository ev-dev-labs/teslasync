import { useTranslation } from 'react-i18next';
import { StatGroup } from '@/components/data-display/stat-reference';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Subhead, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { RegenEfficiencyModel } from '../../lib/regenEfficiency';
import type { RegenSectionState } from '../regen-efficiency';
import { isKnownNumber } from './presentation';

export function DetailedRecoveryEvidence({ model, state }: {
  model: RegenEfficiencyModel;
  state: RegenSectionState;
}) {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();
  const { fmtPercent } = useNumberFormatting();
  return (
    <div className="min-w-0 rounded-xl border border-[var(--border-default)] p-4">
      <Subhead>{t('regen.overview.sampleTitle', 'Detailed returned sample')}</Subhead>
      <Text as="p" variant="caption" className="mt-1">
        {t('regen.overview.sampleScope', 'Measured canonical Drive rows returned by the capped detailed request.')}
      </Text>
      <div className="mt-4 min-h-56">
        {state.isLoading ? <Skeleton height={220} />
          : state.error != null ? <QueryError error={state.error} onRetry={state.onRetry} />
          : !state.isResolved ? (
            // no-action: Query availability is unresolved; retry belongs to the resolved empty/error state.
            <EmptyState className="py-8"
              message={t('regen.states.detailPending', 'Detailed data availability has not resolved.')} />
            )
          : model.accounting.eligibleCount === 0 ? <EmptyState className="py-8" message={
              model.accounting.observedCount === 0
                ? t('regen.overview.sampleEmpty', 'No detailed drives were returned for this window.')
                : t('regen.overview.sampleIneligible', 'Returned drives lack an eligible regen and drive-energy pair.')
            } action={{ label: t('common.retry', 'Retry'), onClick: state.onRetry }} />
          : (
            <div className="space-y-4">
              <StatGroup
                period={{ kind: 'unknown', label: t('regen.overview.sampleTitle', 'Detailed returned sample') }}
                metrics={[
                  {
                    metricId: 'text',
                    occurrenceId: 'regen-sample-recovered',
                    label: t('regen.overview.sampleRecovered', 'Sample recovered'),
                    rawValue: isKnownNumber(model.totalMeasuredRegenWh) ? formatEnergy(model.totalMeasuredRegenWh) : null,
                  },
                  {
                    metricId: 'text',
                    occurrenceId: 'regen-sample-denominator',
                    label: t('regen.overview.sampleDenominator', 'Sample drive energy'),
                    rawValue: isKnownNumber(model.totalMeasuredDriveEnergyWh) ? formatEnergy(model.totalMeasuredDriveEnergyWh) : null,
                  },
                  {
                    metricId: 'text',
                    occurrenceId: 'regen-sample-weighted',
                    label: t('regen.overview.sampleWeighted', 'Energy-weighted share'),
                    rawValue: isKnownNumber(model.energyWeightedRatioPct) ? fmtPercent(model.energyWeightedRatioPct) : null,
                  },
                ]}
              />
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
                <Text as="p" variant="bodySm">
                  {t('regen.overview.quartiles', 'Eligible per-drive ratios: Q1 {{q1}}, median {{median}}, Q3 {{q3}}.', {
                    q1: isKnownNumber(model.ratioStatistics.q1Pct) ? fmtPercent(model.ratioStatistics.q1Pct) : '—',
                    median: isKnownNumber(model.ratioStatistics.medianPct) ? fmtPercent(model.ratioStatistics.medianPct) : '—',
                    q3: isKnownNumber(model.ratioStatistics.q3Pct) ? fmtPercent(model.ratioStatistics.q3Pct) : '—',
                  })}
                </Text>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
