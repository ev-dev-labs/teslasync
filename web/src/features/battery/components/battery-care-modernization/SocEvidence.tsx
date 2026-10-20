import { BatteryCharging, BatteryWarning } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, MetricLabel, MetricValue } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { chartTokens } from '@/lib/tokens';
import type { ArrivalSocBucketId, CareScore, EndSocBucketId } from '../../lib/batteryCare';
import { CareSection } from './CareSection';
import { EvidenceBar } from './EvidenceBar';
import type { CareSectionState } from './state';

interface SocEvidenceProps {
  care: CareScore;
  state: CareSectionState;
  kind: 'finish' | 'arrival';
}

/** Both histograms keep source ordering, count denominators, and exact bins. */
export function SocEvidence({ care, state, kind }: SocEvidenceProps) {
  const { t } = useTranslation();
  const { fmtPercent } = useNumberFormatting();
  const finish = kind === 'finish';
  const labels: Record<EndSocBucketId | ArrivalSocBucketId, string> = {
    belowBand: t('batteryCare.targets.bucket.below', 'Below 20%'),
    careBand: t('batteryCare.targets.bucket.band', '20–80%'),
    aboveBand: t('batteryCare.targets.bucket.above', 'Above 80% to below 95%'),
    highFinish: t('batteryCare.targets.bucket.high', '95–100%'),
    below10: t('batteryCare.arrivals.bucket.below10', 'Below 10%'),
    '10to19': t('batteryCare.arrivals.bucket.10to19', '10–19%'),
    '20to49': t('batteryCare.arrivals.bucket.20to49', '20–49%'),
    '50plus': t('batteryCare.arrivals.bucket.50plus', '50% or above'),
  };
  const buckets = finish ? care.endSocDistribution : care.arrivalSocDistribution;
  const count = finish ? care.sessionsAnalyzed : care.drivesAnalyzed;
  const median = finish ? care.medianEndSocPct : care.medianArrivalSocPct;
  return (
    <CareSection
      title={finish
        ? t('batteryCare.targets.title', 'Charging target evidence')
        : t('batteryCare.arrivals.title', 'Arrival-SoC evidence')}
      description={finish
        ? t('batteryCare.targets.description', 'Observed session-end SoC; this does not measure how long the pack remained at a level')
        : t('batteryCare.arrivals.description', 'Observed end-of-drive SoC, without assumptions about subsequent parking or charging')}
      icon={finish
        ? <BatteryCharging className="h-8 w-8" aria-hidden="true" />
        : <BatteryWarning className="h-8 w-8" aria-hidden="true" />}
      emptyMessage={finish
        ? t('batteryCare.targets.empty', 'No charging sessions with a valid end SoC are available in the returned window.')
        : t('batteryCare.arrivals.empty', 'No drives with a valid arrival SoC are available in the returned window.')}
      hasData={count > 0}
      state={state}
      testId={finish ? 'battery-care-targets' : 'battery-care-arrivals'}
      badge={<Badge variant="neutral">{finish
        ? t('batteryCare.targets.eligible', '{{count}} eligible', { count })
        : t('batteryCare.arrivals.eligible', '{{count}} eligible', { count })}</Badge>}
    >
      <div className="grid min-w-0 gap-4 @xl:grid-cols-[0.65fr_1.35fr]">
        <div className="min-w-0 rounded-xl bg-[var(--surface-2)] p-4">
          <MetricValue>{median != null ? fmtPercent(median) : '—'}</MetricValue>
          <MetricLabel>{finish
            ? t('batteryCare.targets.median', 'Median session-end SoC')
            : t('batteryCare.arrivals.median', 'Median drive-arrival SoC')}</MetricLabel>
        </div>
        <div className="min-w-0 space-y-4">
          {buckets.map((bucket, index) => {
            const values = {
              pct: bucket.share != null ? fmtPercent(bucket.share * 100) : '—',
              count: bucket.count,
            };
            return (
              <EvidenceBar
                key={bucket.id}
                label={labels[bucket.id]}
                value={bucket.share == null ? null : bucket.share * 100}
                max={100}
                color={chartTokens.series[index + (finish ? 1 : 2)]}
                sublabel={finish
                  ? t('batteryCare.targets.bucketValue', '{{pct}} · {{count}} sessions', values)
                  : t('batteryCare.arrivals.bucketValue', '{{pct}} · {{count}} drives', values)}
              />
            );
          })}
        </div>
      </div>
    </CareSection>
  );
}
